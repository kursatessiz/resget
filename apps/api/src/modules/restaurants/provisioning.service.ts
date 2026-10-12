import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@resget/database';
import { DEFAULT_ROLE_TEMPLATES, WELCOME_MESSAGE_CREDITS_DEFAULT, slugify, trialEndFrom } from '@resget/shared';
import type { RestaurantCreatedDTO, RestaurantSignupInput } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { conflict, tooManyRequests } from '../../common/api-error';
import { AttributionService } from '../attribution/attribution.service';
import { PartnerReferralsService } from '../partner-referrals/partner-referrals.service';
import { RateLimiterService } from '../redis/rate-limiter.service';

const DAY_SECONDS = 86_400;

export interface ProvisioningOptions {
  /**
   * True for a restaurant a signed-in user creates for themselves (POST /restaurants): rate limited per user, and the
   * trial and welcome credits go only to the first restaurants the user creates. The console is not limited.
   */
  selfService?: boolean;
}

/**
 * Creates a restaurant the way the seed does, for the owner signing up at
 * /kayit and for the super admin alike (docs/PLATFORM_YONETIMI.md): the
 * restaurant and its first branch, the default role templates, the owner
 * membership, the PRO trial from the plan's trial days and the welcome
 * message credits, all in one transaction with an audit row. A user's later
 * self-service restaurants start on BASIC with empty wallets instead of
 * being refused (docs/PLAN_MATRISI.md): a real second venue is not turned
 * away, it only gets no free PRO time or credits.
 */
@Injectable()
export class RestaurantProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoding: GeocodingService,
    private readonly attribution: AttributionService,
    private readonly partnerReferrals: PartnerReferralsService,
    private readonly config: ConfigService,
    private readonly limiter: RateLimiterService,
  ) {}

  async create(
    ownerUserId: string,
    input: RestaurantSignupInput,
    actorUserId: string,
    /** The measured browser of a self sign-up (docs/ATIF.md); null from the console. */
    visitorId: string | null = null,
    options: ProvisioningOptions = {},
  ): Promise<RestaurantCreatedDTO> {
    const selfService = options.selfService === true;
    const slug = await this.uniqueSlug(input.slug ?? slugify(input.name), Boolean(input.slug));
    // After the slug check, so a taken slug does not use up the day's allowance.
    if (selfService) await this.assertSignupAllowance(ownerUserId);
    // The branch needs a point for courier quotes and routing; typed coordinates win over the geocoder.
    const branchPoint =
      input.branch.lat !== undefined && input.branch.lng !== undefined
        ? { lat: input.branch.lat, lng: input.branch.lng }
        : await this.geocoding.pointFor(input.branch, input.countryCode, null);
    const serviceArea = await this.prisma.serviceArea.findFirst({
      where: {
        countryCode: input.countryCode,
        city: { equals: input.branch.city, mode: 'insensitive' },
        district: { equals: input.branch.district, mode: 'insensitive' },
      },
      select: { id: true },
    });
    const pro = await this.prisma.plan.findFirst({
      where: { code: 'PRO', isActive: true },
      select: { id: true, trialDays: true },
    });
    const basic = await this.prisma.plan.findFirst({ where: { code: 'BASIC' }, select: { id: true } });

    let promotional = true;
    const created = await this.prisma.$transaction(async (tx) => {
      if (selfService) {
        // Serialised per user: two simultaneous sign-ups cannot both count as the first restaurant.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`restaurant-signup:${ownerUserId}`}))`;
        promotional = (await this.restaurantsStartedBy(tx, ownerUserId)) < this.promotionalRestaurantsPerUser();
      }
      const restaurant = await tx.restaurant.create({
        data: {
          slug,
          name: input.name,
          legalName: input.legalName ?? null,
          taxId: input.taxId ?? null,
          countryCode: input.countryCode,
          currency: input.currency,
          timezone: input.timezone,
          defaultLocale: input.defaultLocale,
          serviceAreaId: serviceArea?.id ?? null,
          // Listing is the super admin's decision once the area is launched and the menu reviewed.
          isListed: false,
        },
        select: { id: true, slug: true, name: true },
      });
      await tx.branch.create({
        data: {
          restaurantId: restaurant.id,
          name: input.branch.name,
          addressLine: input.branch.addressLine,
          city: input.branch.city,
          district: input.branch.district,
          postalCode: input.branch.postalCode ?? null,
          phone: input.branch.phone ?? null,
          lat: branchPoint?.lat ?? null,
          lng: branchPoint?.lng ?? null,
        },
      });
      let ownerRoleId: string | null = null;
      for (const template of DEFAULT_ROLE_TEMPLATES) {
        const role = await tx.roleTemplate.create({
          data: {
            restaurantId: restaurant.id,
            templateKey: template.key,
            name: template.key,
            isOwner: template.isOwner,
            permissions: { create: template.permissions.map((permissionKey) => ({ permissionKey })) },
          },
          select: { id: true },
        });
        if (template.isOwner) ownerRoleId = role.id;
      }
      if (!ownerRoleId) throw new Error('owner template missing');
      await tx.membership.create({
        data: {
          userId: ownerUserId,
          restaurantId: restaurant.id,
          roleTemplateId: ownerRoleId,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
      if (pro && promotional) {
        await tx.restaurantSubscription.create({
          data: {
            restaurantId: restaurant.id,
            planId: pro.id,
            status: 'TRIALING',
            trialEndsAt: trialEndFrom(new Date(), pro.trialDays),
          },
        });
      } else if (basic) {
        await tx.restaurantSubscription.create({
          data: { restaurantId: restaurant.id, planId: basic.id, status: 'ACTIVE' },
        });
      }
      for (const [channel, credits] of Object.entries(WELCOME_MESSAGE_CREDITS_DEFAULT) as [
        'SMS' | 'WHATSAPP',
        number,
      ][]) {
        await tx.messageWallet.create({
          data: {
            restaurantId: restaurant.id,
            channel,
            balance: promotional ? credits : 0,
            ...(promotional
              ? {
                  transactions: {
                    create: { type: 'GRANT', delta: credits, balanceAfter: credits, reference: 'welcome' },
                  },
                }
              : {}),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          restaurantId: restaurant.id,
          actorUserId,
          action: 'restaurant.created',
          entity: 'restaurant',
          entityId: restaurant.id,
          meta: { slug, ownerUserId, promotional } as Prisma.InputJsonObject,
        },
      });
      return restaurant;
    });
    // The platform's own pipeline learns about the sign-up; never fails the sign-up itself.
    await this.attribution.onRestaurantCreatedSafely(created.id, ownerUserId, visitorId);
    // An invite link's partner code links the two restaurants and adds the bonus days (docs/RESTORAN_TAVSIYE.md).
    // The link is recorded either way; the new restaurant's bonus days are PRO time, so they follow the trial.
    await this.partnerReferrals.onSignupSafely(created.id, ownerUserId, input.partnerCode, promotional);
    return created;
  }

  /** Self-service creations per user per day (RESTAURANT_SIGNUP_DAILY_LIMIT); 429 over the limit. */
  private async assertSignupAllowance(userId: string): Promise<void> {
    const limit = this.config.get<number>('RESTAURANT_SIGNUP_DAILY_LIMIT') ?? 3;
    if ((await this.limiter.hit(`rl:restaurantsignup:${userId}`, DAY_SECONDS)) > limit)
      throw tooManyRequests('RESTAURANT_SIGNUP_LIMIT', 'Too many restaurants created today');
  }

  /** How many restaurants get the trial and the welcome credits per user (RESTAURANT_TRIAL_GRANTS_PER_USER). */
  private promotionalRestaurantsPerUser(): number {
    return this.config.get<number>('RESTAURANT_TRIAL_GRANTS_PER_USER') ?? 1;
  }

  /**
   * Restaurants the user already owns or created for themselves. Handing a restaurant over does not free a
   * place, so the audit trail counts alongside the owner memberships.
   */
  private async restaurantsStartedBy(tx: Prisma.TransactionClient, userId: string): Promise<number> {
    const [owned, created] = await Promise.all([
      tx.membership.count({ where: { userId, roleTemplate: { isOwner: true } } }),
      tx.auditLog.count({ where: { action: 'restaurant.created', actorUserId: userId } }),
    ]);
    return Math.max(owned, created);
  }

  /** A chosen slug must be free; a derived one gets a numeric suffix until it is. */
  private async uniqueSlug(base: string, chosen: boolean): Promise<string> {
    const taken = new Set(
      (await this.prisma.restaurant.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map(
        (r) => r.slug,
      ),
    );
    if (!taken.has(base)) return base;
    if (chosen) throw conflict('SLUG_TAKEN', 'Slug already in use');
    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${base.slice(0, 60 - String(n).length - 1)}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
    throw conflict('SLUG_TAKEN', 'Slug already in use');
  }
}
