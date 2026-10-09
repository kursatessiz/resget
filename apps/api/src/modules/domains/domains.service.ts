import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@resget/database';
import type { CustomDomainDTO } from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { EntitlementsService } from '../features/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import { badRequest, conflict, notFound } from '../../common/api-error';
import { DOMAIN_VERIFIER, domainChallenge } from './domain-verifier';
import type { DomainVerifierAdapter } from './domain-verifier';

const domainSelect = {
  id: true,
  slug: true,
  isActive: true,
  customDomain: true,
  customDomainVerifiedAt: true,
} as const;
type DomainRow = Prisma.RestaurantGetPayload<{ select: typeof domainSelect }>;

/**
 * A restaurant's own host for its ordering page (docs/VITRIN.md, "Kendi alan
 * adı"). The owner saves the host, points a CNAME at the platform and asks
 * for a check; once DNS reaches us the host serves /<slug> and Caddy issues
 * its certificate on first visit. A lapsed PRO plan keeps the record but
 * stops serving, exactly like the other PRO features.
 */
@Injectable()
export class DomainsService {
  private readonly logger = new Logger(DomainsService.name);
  private readonly target: string;
  private readonly lastChecks = new Map<string, { ok: boolean; seen: string[]; ownershipProven: boolean }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(DOMAIN_VERIFIER) private readonly verifier: DomainVerifierAdapter,
    private readonly features: FeatureFlagsService,
    private readonly plans: EntitlementsService,
  ) {
    this.target = new URL(this.config.getOrThrow<string>('PUBLIC_APP_URL')).hostname.toLowerCase();
  }

  async status(restaurantId: string): Promise<CustomDomainDTO> {
    const row = await this.prisma.restaurant.findUnique({ where: { id: restaurantId }, select: domainSelect });
    if (!row) throw notFound('NOT_FOUND', 'Restaurant not found');
    return this.toDto(row);
  }

  /** Sets or clears the host; the platform's own host and its subdomains are never accepted. */
  async set(restaurantId: string, domain: string | null, actorUserId: string): Promise<CustomDomainDTO> {
    if (domain !== null) {
      if (domain === this.target || domain.endsWith(`.${this.target}`))
        throw badRequest('DOMAIN_INVALID', 'The platform host cannot be a custom domain');
      const taken = await this.prisma.restaurant.findUnique({ where: { customDomain: domain }, select: { id: true } });
      if (taken && taken.id !== restaurantId) throw conflict('DOMAIN_TAKEN', 'Domain belongs to another restaurant');
    }
    const current = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { customDomain: true },
    });
    if (!current) throw notFound('NOT_FOUND', 'Restaurant not found');
    const unchanged = current.customDomain === domain;
    const row = await this.prisma.restaurant.update({
      where: { id: restaurantId },
      // A new host starts unverified; saving the same host again keeps its verification.
      data: unchanged ? {} : { customDomain: domain, customDomainVerifiedAt: null },
      select: domainSelect,
    });
    if (!unchanged) {
      this.lastChecks.delete(restaurantId);
      await this.prisma.auditLog.create({
        data: {
          actorUserId,
          restaurantId,
          action: domain ? 'domain.set' : 'domain.clear',
          entity: 'restaurant',
          entityId: restaurantId,
          meta: { domain, previous: current.customDomain },
        },
      });
    }
    return this.toDto(row);
  }

  /**
   * Asks DNS where the host points (a CNAME to the platform host or the same A records) and whether the owner
   * proof is published; both are needed before the host serves the restaurant's page.
   */
  async verify(restaurantId: string, actorUserId: string): Promise<CustomDomainDTO> {
    const row = await this.prisma.restaurant.findUnique({ where: { id: restaurantId }, select: domainSelect });
    if (!row) throw notFound('NOT_FOUND', 'Restaurant not found');
    if (!row.customDomain) throw conflict('DOMAIN_NOT_SET', 'No domain to verify');
    const seen = await this.verifier.lookup(row.customDomain);
    let ok = seen.includes(this.target);
    if (!ok && seen.length > 0) {
      const ours = await this.verifier.addressesOf(this.target);
      ok = ours.length > 0 && seen.every((record) => ours.includes(record));
    }
    const challenge = this.challengeOf(row.id, row.customDomain);
    const ownershipProven = (await this.verifier.txt(challenge.name)).includes(challenge.value);
    ok = ok && ownershipProven;
    this.lastChecks.set(restaurantId, { ok, seen, ownershipProven });
    if (!ok) return this.toDto(row);
    const updated = await this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { customDomainVerifiedAt: row.customDomainVerifiedAt ?? new Date() },
      select: domainSelect,
    });
    if (!row.customDomainVerifiedAt) {
      this.logger.log(`custom domain verified: ${row.customDomain} -> ${row.slug}`);
      await this.prisma.auditLog.create({
        data: {
          actorUserId,
          restaurantId,
          action: 'domain.verify',
          entity: 'restaurant',
          entityId: restaurantId,
          meta: { domain: row.customDomain, seen },
        },
      });
    }
    return this.toDto(updated);
  }

  /** The slug a verified, serving host maps to; null for anything else (the web falls back to the platform page). */
  async resolve(host: string): Promise<string | null> {
    const row = await this.prisma.restaurant.findUnique({
      where: { customDomain: host.toLowerCase() },
      select: domainSelect,
    });
    if (!row) return null;
    // A switched-off module stops serving the domain (docs/OZELLIK_ANAHTARLARI.md); the record stays.
    if (!(await this.features.isEnabled('custom_domain', row.id))) return null;
    return (await this.isServing(row)) ? row.slug : null;
  }

  private challengeOf(restaurantId: string, host: string): { name: string; value: string } {
    return domainChallenge(this.config.getOrThrow<string>('JWT_SECRET'), restaurantId, host);
  }

  private async isServing(row: DomainRow): Promise<boolean> {
    return row.isActive && row.customDomainVerifiedAt !== null && (await this.plans.has(row.id, 'custom_domain'));
  }

  private async toDto(row: DomainRow): Promise<CustomDomainDTO> {
    return {
      domain: row.customDomain,
      verifiedAt: row.customDomainVerifiedAt?.toISOString() ?? null,
      target: this.target,
      challenge: row.customDomain ? this.challengeOf(row.id, row.customDomain) : null,
      active: await this.isServing(row),
      lastCheck: this.lastChecks.get(row.id) ?? null,
    };
  }
}
