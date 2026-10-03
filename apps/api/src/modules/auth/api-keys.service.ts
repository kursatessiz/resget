import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@resget/database';
import { formatApiKeyToken, parseApiKeyToken } from '@resget/shared';
import type { ApiKeyDTO, ApiKeyPermission, CreateApiKeyInput, CreatedApiKeyDTO, PermissionKey } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { forbidden, notFound } from '../../common/api-error';
import type { AuthUser, TenantContext } from './tenant-context';

const keySelect = Prisma.validator<Prisma.RestaurantApiKeySelect>()({
  id: true,
  restaurantId: true,
  keyId: true,
  name: true,
  permissions: true,
  lastUsedAt: true,
  createdAt: true,
  revokedAt: true,
  createdBy: { select: { id: true, phone: true, fullName: true, isSuperAdmin: true } },
});
type KeyRow = Prisma.RestaurantApiKeyGetPayload<{ select: typeof keySelect }>;

/** What a valid key stands for on a request. */
export interface ApiKeyPrincipal {
  id: string;
  keyId: string;
  restaurantId: string;
  permissions: Set<PermissionKey>;
  /** Actions taken with the key are attributed to the member who minted it. */
  user: AuthUser;
}

/** Only how often lastUsedAt is written, so a busy integration does not turn every call into an update. */
const LAST_USED_WRITE_MS = 60_000;

/** scrypt cost for key secrets: a few milliseconds per check, salted per key and peppered server-side. */
const SCRYPT = { N: 4096, r: 8, p: 1 } as const;
/** A verified token is remembered briefly so a busy integration pays the scrypt cost once a minute, not per call. */
const VERIFIED_TTL_MS = 60_000;
const VERIFIED_MAX = 1000;

/**
 * Restaurant API keys (docs/API_ERISIMI.md). The secret exists in clear only
 * in the creation response; the row keeps a scrypt digest of it, salted with
 * the key's own id and a server-side pepper, compared in constant time, so a
 * copied table alone verifies nothing. A revoked key stays listed so the
 * history is visible and stops working on the next request.
 */
@Injectable()
export class ApiKeysService {
  private readonly lastUsedWritten = new Map<string, number>();
  private readonly verified = new Map<string, { principal: ApiKeyPrincipal; until: number }>();
  private readonly pepper: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.pepper = `api-key:${config.getOrThrow<string>('JWT_SECRET')}`;
  }

  async list(restaurantId: string): Promise<ApiKeyDTO[]> {
    const rows = await this.prisma.restaurantApiKey.findMany({
      where: { restaurantId },
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
      select: keySelect,
    });
    return rows.map((row) => this.toDto(row));
  }

  /** A key never carries a permission its creator does not hold; the owner may grant any grantable one. */
  async create(tenant: TenantContext, user: AuthUser, input: CreateApiKeyInput): Promise<CreatedApiKeyDTO> {
    const missing = input.permissions.filter((p) => !tenant.permissions.has(p));
    if (missing.length > 0) throw forbidden('FORBIDDEN', `Cannot grant ${missing.join(', ')}`);
    const keyId = randomBytes(8).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.restaurantApiKey.create({
        data: {
          restaurantId: tenant.restaurantId,
          keyId,
          name: input.name,
          secretHash: this.hash(keyId, secret),
          permissions: [...new Set(input.permissions)],
          createdByUserId: user.id,
        },
        select: keySelect,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          restaurantId: tenant.restaurantId,
          action: 'api_key.create',
          entity: 'restaurant_api_key',
          entityId: created.id,
          meta: { keyId, name: input.name, permissions: created.permissions },
        },
      });
      return created;
    });
    return { ...this.toDto(row), token: formatApiKeyToken(keyId, secret) };
  }

  async revoke(tenant: TenantContext, user: AuthUser, id: string): Promise<ApiKeyDTO> {
    const row = await this.prisma.restaurantApiKey.findFirst({
      where: { id, restaurantId: tenant.restaurantId },
      select: keySelect,
    });
    if (!row) throw notFound('API_KEY_NOT_FOUND', 'API key not found');
    if (row.revokedAt) return this.toDto(row);
    for (const [token, entry] of this.verified) if (entry.principal.id === id) this.verified.delete(token);
    const updated = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.restaurantApiKey.update({
        where: { id },
        data: { revokedAt: new Date() },
        select: keySelect,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          restaurantId: tenant.restaurantId,
          action: 'api_key.revoke',
          entity: 'restaurant_api_key',
          entityId: id,
          meta: { keyId: row.keyId, name: row.name },
        },
      });
      return revoked;
    });
    return this.toDto(updated);
  }

  /** Resolves a presented token; null for an unknown, malformed or revoked key, or one whose creator is gone. */
  async authenticate(token: string): Promise<ApiKeyPrincipal | null> {
    const parsed = parseApiKeyToken(token);
    if (!parsed) return null;
    const remembered = this.verified.get(token);
    if (remembered && remembered.until > Date.now()) {
      this.touch(remembered.principal.id);
      return remembered.principal;
    }
    const row = await this.prisma.restaurantApiKey.findUnique({
      where: { keyId: parsed.keyId },
      select: { ...keySelect, secretHash: true },
    });
    if (!row || row.revokedAt || !row.createdBy) return null;
    const expected = Buffer.from(row.secretHash, 'hex');
    const actual = Buffer.from(this.hash(row.keyId, parsed.secret), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    this.touch(row.id);
    const principal: ApiKeyPrincipal = {
      id: row.id,
      keyId: row.keyId,
      restaurantId: row.restaurantId,
      permissions: new Set(row.permissions as PermissionKey[]),
      user: {
        id: row.createdBy.id,
        phone: row.createdBy.phone,
        fullName: row.createdBy.fullName,
        isSuperAdmin: false,
      },
    };
    if (this.verified.size >= VERIFIED_MAX) this.verified.clear();
    this.verified.set(token, { principal, until: Date.now() + VERIFIED_TTL_MS });
    return principal;
  }

  private touch(id: string): void {
    const now = Date.now();
    const last = this.lastUsedWritten.get(id) ?? 0;
    if (now - last < LAST_USED_WRITE_MS) return;
    this.lastUsedWritten.set(id, now);
    void this.prisma.restaurantApiKey
      .update({ where: { id }, data: { lastUsedAt: new Date(now) } })
      .catch(() => undefined);
  }

  private hash(keyId: string, secret: string): string {
    return scryptSync(secret, `${keyId}:${this.pepper}`, 32, SCRYPT).toString('hex');
  }

  private toDto(row: KeyRow): ApiKeyDTO {
    return {
      id: row.id,
      name: row.name,
      keyId: row.keyId,
      permissions: row.permissions as ApiKeyPermission[],
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdBy: row.createdBy ? { fullName: row.createdBy.fullName } : null,
    };
  }
}
