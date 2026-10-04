import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import { DEFAULT_ROLE_TEMPLATES, WELCOME_MESSAGE_CREDITS_DEFAULT, slugify, trialEndFrom } from '@resget/shared';
import type { RestaurantCreatedDTO, RestaurantSignupInput } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { conflict } from '../../common/api-error';
import { AttributionService } from '../attribution/attribution.service';
import { PartnerReferralsService } from '../partner-referrals/partner-referrals.service';

/**
 * Creates a restaurant the way the seed does, for the owner signing up at
 * /kayit and for the super admin alike (docs/PLATFORM_YONETIMI.md): the
 * restaurant and its first branch, the default role templates, the owner
 * membership, the PRO trial from the plan's trial days and the welcome
 * message credits, all in one transaction with an audit row.
 */
@Injectable()
export class RestaurantProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoding: GeocodingService,
    private readonly attribution: AttributionService,
    private readonly partnerReferrals: PartnerReferralsService,
  ) {}

  async create(
    ownerUserId: string,
    input: RestaurantSignupInput,
    actorUserId: string,
    /** The measured browser of a self sign-up (docs/ATIF.md); null from the console. */
    visitorId: string | null = null,
  ): Promise<RestaurantCreatedDTO> {
    const slug = await this.uniqueSlug(input.slug ?? slugify(input.name), Boolean(input.slug));
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
    const basic = pro ? null : await this.prisma.plan.findFirst({ where: { code: 'BASIC' }, select: { id: true } });

    const created = await this.prisma.$transaction(async (tx) => {
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
      if (pro) {
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
            balance: credits,
            transactions: { create: { type: 'GRANT', delta: credits, balanceAfter: credits, reference: 'welcome' } },
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
          meta: { slug, ownerUserId } as Prisma.InputJsonObject,
        },
      });
      return restaurant;
    });
    // The platform's own pipeline learns about the sign-up; never fails the sign-up itself.
    await this.attribution.onRestaurantCreatedSafely(created.id, ownerUserId, visitorId);
    // An invite link's partner code links the two restaurants and adds the bonus days (docs/RESTORAN_TAVSIYE.md).
    await this.partnerReferrals.onSignupSafely(created.id, ownerUserId, input.partnerCode);
    return created;
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
