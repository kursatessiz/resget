import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import { DeliveryFeePolicySchema, dispatchSettingsFrom } from '@resget/shared';
import type { RestaurantSettingsDTO, UpdateRestaurantSettingsInput } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { conflict, notFound } from '../../common/api-error';

const settingsSelect = Prisma.validator<Prisma.RestaurantSelect>()({
  id: true,
  slug: true,
  name: true,
  legalName: true,
  taxId: true,
  countryCode: true,
  currency: true,
  timezone: true,
  defaultLocale: true,
  isListed: true,
  listingRequestedAt: true,
  listingReviewedAt: true,
  listingReviewNote: true,
  commissionBps: true,
  paymentMode: true,
  pspPercentBps: true,
  pspFixedMinor: true,
  deliveryMode: true,
  courierProviderId: true,
  deliveryFeePolicy: true,
  dispatchSettings: true,
  logoUrl: true,
  themePrimary: true,
  customDomain: true,
  customDomainVerifiedAt: true,
  branches: {
    where: { isActive: true },
    select: { id: true, name: true, city: true, district: true },
    orderBy: { name: 'asc' },
  },
});

@Injectable()
export class RestaurantsService {
  constructor(private readonly prisma: PrismaService) {}

  async settings(tenant: TenantContext): Promise<RestaurantSettingsDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: tenant.restaurantId },
      select: settingsSelect,
    });
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    return this.toDto(restaurant, tenant);
  }

  /** Owner-editable settings only; commission, fees and listing are platform data (see shared schema). */
  async update(tenant: TenantContext, input: UpdateRestaurantSettingsInput): Promise<RestaurantSettingsDTO> {
    const { deliveryFeePolicy, dispatchSettings, ...scalars } = input;
    const data: Prisma.RestaurantUpdateInput = { ...scalars };
    if (deliveryFeePolicy !== undefined) {
      data.deliveryFeePolicy = deliveryFeePolicy === null ? Prisma.DbNull : deliveryFeePolicy;
    }
    if (dispatchSettings !== undefined) data.dispatchSettings = dispatchSettings;
    const restaurant = await this.prisma.restaurant.update({
      where: { id: tenant.restaurantId },
      data,
      select: settingsSelect,
    });
    return this.toDto(restaurant, tenant);
  }

  /**
   * The restaurant asks the console to list it (docs/PLATFORM_YONETIMI.md).
   * A request needs something to review: one item on sale and an active
   * branch. The decision comes back as a message and on this screen.
   */
  async requestListing(tenant: TenantContext): Promise<RestaurantSettingsDTO> {
    const [restaurant, items, branches] = await Promise.all([
      this.prisma.restaurant.findUnique({ where: { id: tenant.restaurantId }, select: { isListed: true } }),
      this.prisma.menuItem.count({ where: { restaurantId: tenant.restaurantId, isAvailable: true } }),
      this.prisma.branch.count({ where: { restaurantId: tenant.restaurantId, isActive: true } }),
    ]);
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    if (restaurant.isListed) throw conflict('ALREADY_LISTED', 'Restaurant is already listed');
    if (items === 0 || branches === 0) throw conflict('LISTING_NOT_READY', 'Menu or branch missing');
    const updated = await this.prisma.restaurant.update({
      where: { id: tenant.restaurantId },
      data: { listingRequestedAt: new Date(), listingReviewedAt: null, listingReviewNote: null },
      select: settingsSelect,
    });
    return this.toDto(updated, tenant);
  }

  private toDto(
    row: Prisma.RestaurantGetPayload<{ select: typeof settingsSelect }>,
    tenant: TenantContext,
  ): RestaurantSettingsDTO {
    const policy = DeliveryFeePolicySchema.safeParse(row.deliveryFeePolicy);
    return {
      ...row,
      listingRequestedAt: row.listingRequestedAt?.toISOString() ?? null,
      listingReviewedAt: row.listingReviewedAt?.toISOString() ?? null,
      customDomainVerifiedAt: row.customDomainVerifiedAt?.toISOString() ?? null,
      deliveryFeePolicy: policy.success ? policy.data : null,
      dispatchSettings: dispatchSettingsFrom(row.dispatchSettings),
      effectivePlan: tenant.effectivePlan,
      planName: tenant.planName,
      entitlements: [...tenant.entitlements],
      permissions: [...tenant.permissions],
    };
  }
}
