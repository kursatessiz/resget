import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@resget/database';
import { apiKeyUsageWindow, formatApiKeyToken, parseApiKeyToken } from '@resget/shared';
import type {
  ApiKeyDTO,
  ApiKeyPermission,
  ApiKeyUsageDTO,
  CreateApiKeyInput,
  CreatedApiKeyDTO,
  PermissionKey,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { forbidden, notFound, unauthorized } from '../../common/api-error';
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
  expiresAt: true,
  createdBy: { select: { id: true, phone: true, fullName: true, isSuperAdmin: true } },
});
type KeyRow = Prisma.RestaurantApiKeyGetPayload<{ select: typeof keySelect }>;

/** What a valid key stands for on a request. */
export interface ApiKeyPrincipal {
  id: string;
  keyId: string;
  restaurantId: string;
  permissions: Set<PermissionKey>;
  expiresAt: Date | null;
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
/** Request counts are kept in memory and added to the daily rows this often (and before any read of them). */
const USAGE_FLUSH_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Restaurant API keys (docs/API_ERISIMI.md). The secret exists in clear only
 * in the creation response; the row keeps a scrypt digest of it, salted with
 * the key's own id and a server-side pepper, compared in constant time, so a
 * copied table alone verifies nothing. A revoked key stays listed so the
 * history is visible and stops working on the next request.
 */
@Injectable()
export class ApiKeysService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApiKeysService.name);
  /** Requests not yet written, per key and UTC day: `<keyId row id>|<YYYY-MM-DD>`. */
  private pendingUsage = new Map<string, { id: string; restaurantId: string; day: string; requests: number }>();
  private usageTimer: NodeJS.Timeout | null = null;
  private readonly lastUsedWritten = new Map<string, number>();
  private readonly verified = new Map<string, { principal: ApiKeyPrincipal; until: number }>();
  private readonly pepper: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.pepper = `api-key:${config.getOrThrow<string>('JWT_SECRET')}`;
  }

  onModuleInit(): void {
    this.usageTimer = setInterval(() => void this.flushUsage(), USAGE_FLUSH_MS);
    this.usageTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.usageTimer) clearInterval(this.usageTimer);
    await this.flushUsage();
  }

  async list(restaurantId: string): Promise<ApiKeyDTO[]> {
    await this.flushUsage();
    const rows = await this.prisma.restaurantApiKey.findMany({
      where: { restaurantId },
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
      select: keySelect,
    });
    const [first] = apiKeyUsageWindow(new Date());
    const sums = await this.prisma.restaurantApiKeyUsage.groupBy({
      by: ['apiKeyId'],
      where: { restaurantId, day: { gte: new Date(`${first}T00:00:00.000Z`) } },
      _sum: { requests: true },
    });
    const byKey = new Map(sums.map((s) => [s.apiKeyId, s._sum.requests ?? 0]));
    return rows.map((row) => this.toDto(row, byKey.get(row.id) ?? 0));
  }

  /** The key's requests per UTC day over the usage window, days without requests included as zero. */
  async usage(restaurantId: string, id: string): Promise<ApiKeyUsageDTO> {
    const key = await this.prisma.restaurantApiKey.findFirst({ where: { id, restaurantId }, select: { id: true } });
    if (!key) throw notFound('API_KEY_NOT_FOUND', 'API key not found');
    await this.flushUsage();
    const window = apiKeyUsageWindow(new Date());
    const rows = await this.prisma.restaurantApiKeyUsage.findMany({
      where: { apiKeyId: id, day: { gte: new Date(`${window[0]}T00:00:00.000Z`) } },
      select: { day: true, requests: true },
    });
    const counts = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), r.requests]));
    const days = window.map((day) => ({ day, requests: counts.get(day) ?? 0 }));
    return { id, days, total: days.reduce((sum, d) => sum + d.requests, 0) };
  }

  /**
   * Adds the counted requests to the daily rows. The map is swapped first, so
   * requests counted meanwhile wait for the next pass; a failed write puts its
   * count back rather than losing it.
   */
  async flushUsage(): Promise<void> {
    if (this.pendingUsage.size === 0) return;
    const batch = [...this.pendingUsage.values()];
    this.pendingUsage = new Map();
    for (const entry of batch) {
      const day = new Date(`${entry.day}T00:00:00.000Z`);
      try {
        await this.prisma.restaurantApiKeyUsage.upsert({
          where: { apiKeyId_day: { apiKeyId: entry.id, day } },
          create: { apiKeyId: entry.id, restaurantId: entry.restaurantId, day, requests: entry.requests },
          update: { requests: { increment: entry.requests } },
        });
      } catch (err) {
        // A key deleted with its restaurant has nowhere to count; anything else is retried on the next pass.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') continue;
        this.logger.warn(`API key usage not written: ${(err as Error).message}`);
        this.count(entry.id, entry.restaurantId, entry.requests, entry.day);
      }
    }
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
          expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * DAY_MS) : null,
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
          meta: {
            keyId,
            name: input.name,
            permissions: created.permissions,
            expiresAt: created.expiresAt?.toISOString() ?? null,
          },
        },
      });
      return created;
    });
    return { ...this.toDto(row, 0), token: formatApiKeyToken(keyId, secret) };
  }

  async revoke(tenant: TenantContext, user: AuthUser, id: string): Promise<ApiKeyDTO> {
    const row = await this.prisma.restaurantApiKey.findFirst({
      where: { id, restaurantId: tenant.restaurantId },
      select: keySelect,
    });
    if (!row) throw notFound('API_KEY_NOT_FOUND', 'API key not found');
    if (row.revokedAt) return this.toDto(row, 0);
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
    return this.toDto(updated, 0);
  }

  /**
   * Resolves a presented token; null for an unknown, malformed or revoked key,
   * or one whose creator is gone, deleted or no longer an active member. A key
   * acts with at most its creator's current access: permissions their role
   * lost since are dropped. A valid key past its date throws 401
   * API_KEY_EXPIRED so the integration can tell it apart from a wrong key.
   */
  async authenticate(token: string): Promise<ApiKeyPrincipal | null> {
    const parsed = parseApiKeyToken(token);
    if (!parsed) return null;
    const remembered = this.verified.get(token);
    if (remembered && remembered.until > Date.now()) return this.admit(remembered.principal);
    const row = await this.prisma.restaurantApiKey.findUnique({
      where: { keyId: parsed.keyId },
      select: { ...keySelect, secretHash: true },
    });
    if (!row || row.revokedAt || !row.createdBy) return null;
    const expected = Buffer.from(row.secretHash, 'hex');
    const actual = Buffer.from(this.hash(row.keyId, parsed.secret), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const creator = await this.prisma.membership.findFirst({
      where: { userId: row.createdBy.id, restaurantId: row.restaurantId, status: 'ACTIVE', user: { deletedAt: null } },
      select: { roleTemplate: { select: { isOwner: true, permissions: { select: { permissionKey: true } } } } },
    });
    if (!creator) return null;
    const held = new Set(creator.roleTemplate.permissions.map((p) => p.permissionKey));
    const permissions = (row.permissions as PermissionKey[]).filter(
      (key) => creator.roleTemplate.isOwner || held.has(key),
    );
    const principal: ApiKeyPrincipal = {
      id: row.id,
      keyId: row.keyId,
      restaurantId: row.restaurantId,
      permissions: new Set(permissions),
      expiresAt: row.expiresAt,
      user: {
        id: row.createdBy.id,
        phone: row.createdBy.phone,
        fullName: row.createdBy.fullName,
        isSuperAdmin: false,
      },
    };
    if (this.verified.size >= VERIFIED_MAX) this.verified.clear();
    this.verified.set(token, { principal, until: Date.now() + VERIFIED_TTL_MS });
    return this.admit(principal);
  }

  /** The last check for a verified key: its date, then the request is counted and lastUsedAt refreshed. */
  private admit(principal: ApiKeyPrincipal): ApiKeyPrincipal {
    if (principal.expiresAt && principal.expiresAt.getTime() <= Date.now()) {
      throw unauthorized('API key expired', 'API_KEY_EXPIRED');
    }
    this.count(principal.id, principal.restaurantId, 1);
    this.touch(principal.id);
    return principal;
  }

  private count(id: string, restaurantId: string, requests: number, day = new Date().toISOString().slice(0, 10)): void {
    const key = `${id}|${day}`;
    const entry = this.pendingUsage.get(key);
    if (entry) entry.requests += requests;
    else this.pendingUsage.set(key, { id, restaurantId, day, requests });
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

  private toDto(row: KeyRow, requestsLastDays: number): ApiKeyDTO {
    return {
      id: row.id,
      name: row.name,
      keyId: row.keyId,
      permissions: row.permissions as ApiKeyPermission[],
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      requestsLastDays,
      createdBy: row.createdBy ? { fullName: row.createdBy.fullName } : null,
    };
  }
}
