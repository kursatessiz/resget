import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
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
import { forbidden, notFound, tooManyRequests, unauthorized } from '../../common/api-error';
import { RateLimiterService } from '../redis/rate-limiter.service';
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

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/** scrypt cost for key secrets: a few milliseconds per check, salted per key and peppered server-side. */
const SCRYPT = { N: 4096, r: 8, p: 1 } as const;
/** A verified token is remembered briefly so a busy integration pays the scrypt cost once a minute, not per call. */
const VERIFIED_TTL_MS = 60_000;
const VERIFIED_MAX = 1000;
/** Failed verifications are counted over this window, per key id and per client address (docs/API_ERISIMI.md). */
const FAILURE_WINDOW_SECONDS = 60;
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
  /** Verifications running now, by canonical token: simultaneous requests with one token share one hash. */
  private readonly verifying = new Map<string, Promise<ApiKeyPrincipal | null>>();
  /** Hashes in flight in this process per failure counter, so a burst cannot outrun the recorded failures. */
  private readonly pendingChecks = new Map<string, number>();
  private readonly pepper: string;
  private readonly failuresPerKey: number;
  private readonly failuresPerKeyClient: number;
  private readonly failuresPerClient: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: RateLimiterService,
    config: ConfigService,
  ) {
    this.pepper = `api-key:${config.getOrThrow<string>('JWT_SECRET')}`;
    this.failuresPerKey = config.get<number>('API_KEY_FAILURE_LIMIT_PER_KEY') ?? 100;
    this.failuresPerKeyClient = config.get<number>('API_KEY_FAILURE_LIMIT_PER_KEY_CLIENT') ?? 10;
    this.failuresPerClient = config.get<number>('API_KEY_FAILURE_LIMIT_PER_CLIENT') ?? 30;
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
          secretHash: await this.hash(keyId, secret),
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
   *
   * The secret is hashed with scrypt, which is costly, so wrong attempts are
   * counted per key id and per client address and refused with 429 once over
   * the limit, before anything is hashed. The token is remembered under its
   * parsed form, so padding the header with characters parsing strips does not
   * pay the hash again.
   */
  async authenticate(token: string, client?: string): Promise<ApiKeyPrincipal | null> {
    const parsed = parseApiKeyToken(token);
    if (!parsed) return null;
    const canonical = formatApiKeyToken(parsed.keyId, parsed.secret);
    const remembered = this.verified.get(canonical);
    if (remembered && remembered.until > Date.now()) return this.admit(remembered.principal);
    let running = this.verifying.get(canonical);
    if (!running) {
      running = this.verify(parsed.keyId, parsed.secret, canonical, client).finally(() =>
        this.verifying.delete(canonical),
      );
      this.verifying.set(canonical, running);
    }
    const principal = await running;
    return principal ? this.admit(principal) : null;
  }

  private async verify(
    keyId: string,
    secret: string,
    canonical: string,
    client: string | undefined,
  ): Promise<ApiKeyPrincipal | null> {
    const clientKey = client ? `rl:apikeyfail:client:${client}` : null;
    // An address already over its failures is turned away before even the lookup.
    if (clientKey && (await this.limiter.count(clientKey)) >= this.failuresPerClient) throw this.tooManyFailures();
    const row = await this.prisma.restaurantApiKey.findUnique({
      where: { keyId },
      select: { ...keySelect, secretHash: true },
    });
    if (!row || row.revokedAt || !row.createdBy) {
      if (clientKey) await this.limiter.hit(clientKey, FAILURE_WINDOW_SECONDS);
      return null;
    }
    // Per key and client first: someone who only knows a key id can lock out their own address, not the integration.
    // The per key ceiling still bounds a flood spread over many addresses.
    const counters = [{ key: `rl:apikeyfail:key:${row.keyId}`, limit: this.failuresPerKey }];
    if (clientKey) {
      counters.push({ key: `rl:apikeyfail:keyclient:${row.keyId}:${client}`, limit: this.failuresPerKeyClient });
      counters.push({ key: clientKey, limit: this.failuresPerClient });
    }
    const done = await this.reserveHash(counters);
    let matches: boolean;
    try {
      const expected = Buffer.from(row.secretHash, 'hex');
      const actual = Buffer.from(await this.hash(row.keyId, secret), 'hex');
      matches = expected.length === actual.length && timingSafeEqual(expected, actual);
    } finally {
      done();
    }
    if (!matches) {
      await Promise.all(counters.map((c) => this.limiter.hit(c.key, FAILURE_WINDOW_SECONDS)));
      return null;
    }
    const principal = await this.principalOf(row);
    if (!principal) return null;
    if (this.verified.size >= VERIFIED_MAX) this.verified.clear();
    this.verified.set(canonical, { principal, until: Date.now() + VERIFIED_TTL_MS });
    return principal;
  }

  /**
   * Refuses (429) when a counter's recorded failures plus the hashes already running here reach its limit, else
   * holds a place for this hash; the returned function gives it back. The check and the hold happen in one step.
   */
  private async reserveHash(counters: { key: string; limit: number }[]): Promise<() => void> {
    const recorded = await Promise.all(counters.map((c) => this.limiter.count(c.key)));
    const over = counters.some((c, i) => recorded[i] + (this.pendingChecks.get(c.key) ?? 0) >= c.limit);
    if (over) throw this.tooManyFailures();
    for (const c of counters) this.pendingChecks.set(c.key, (this.pendingChecks.get(c.key) ?? 0) + 1);
    return () => {
      for (const c of counters) {
        const left = (this.pendingChecks.get(c.key) ?? 1) - 1;
        if (left <= 0) this.pendingChecks.delete(c.key);
        else this.pendingChecks.set(c.key, left);
      }
    };
  }

  private tooManyFailures(): ReturnType<typeof tooManyRequests> {
    return tooManyRequests('RATE_LIMITED', 'Too many failed API key attempts');
  }

  /**
   * The key as it stands now, for a stream opened with it (docs/SIPARIS_VE_SEVK.md): null once it is revoked
   * or past its date, or its creator lost access. No request is counted and the cache is not used.
   */
  async current(id: string, now: Date = new Date()): Promise<ApiKeyPrincipal | null> {
    const row = await this.prisma.restaurantApiKey.findUnique({ where: { id }, select: keySelect });
    if (!row || row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;
    return this.principalOf(row);
  }

  /** A key acts with at most its creator's current access; null when the creator is gone or no longer active. */
  private async principalOf(row: KeyRow): Promise<ApiKeyPrincipal | null> {
    if (!row.createdBy) return null;
    const creator = await this.prisma.membership.findFirst({
      where: { userId: row.createdBy.id, restaurantId: row.restaurantId, status: 'ACTIVE', user: { deletedAt: null } },
      select: { roleTemplate: { select: { isOwner: true, permissions: { select: { permissionKey: true } } } } },
    });
    if (!creator) return null;
    const held = new Set(creator.roleTemplate.permissions.map((p) => p.permissionKey));
    const permissions = (row.permissions as PermissionKey[]).filter(
      (key) => creator.roleTemplate.isOwner || held.has(key),
    );
    return {
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

  /** Off the event loop (libuv thread pool), so a flood of checks cannot stall every other request. */
  private async hash(keyId: string, secret: string): Promise<string> {
    return (await scryptAsync(secret, `${keyId}:${this.pepper}`, 32, SCRYPT)).toString('hex');
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
