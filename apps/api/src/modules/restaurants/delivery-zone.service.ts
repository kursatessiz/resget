import { Injectable } from '@nestjs/common';
import { Prisma } from '@resget/database';
import { DeliveryZoneSchema, deliveryZoneRefusal, haversineMeters } from '@resget/shared';
import type { DeliveryZone, DeliveryZoneDTO, GeoPoint, UpdateDeliveryZoneInput } from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { conflict } from '../../common/api-error';

/**
 * Delivery zone (docs/VITRIN.md, "Teslimat bölgesi"): radius, minimum basket
 * and fee bands, applied to consumer delivery orders while the
 * delivery_zones module is on for the restaurant.
 */
@Injectable()
export class DeliveryZoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
  ) {}

  /** The zone that applies now: null while the module is off or nothing is stored. */
  async activeZone(restaurant: { id: string; deliveryZone: unknown }): Promise<DeliveryZone | null> {
    if (restaurant.deliveryZone === null || restaurant.deliveryZone === undefined) return null;
    if (!(await this.features.isEnabled('delivery_zones', restaurant.id))) return null;
    const parsed = DeliveryZoneSchema.safeParse(restaurant.deliveryZone);
    return parsed.success ? parsed.data : null;
  }

  /** Straight-line metres from the branch; null when either end has no point. */
  distanceFrom(
    branch: { lat: number | null; lng: number | null } | null,
    point: GeoPoint | null | undefined,
  ): number | null {
    if (!branch || branch.lat === null || branch.lng === null || !point) return null;
    return Math.round(haversineMeters({ lat: branch.lat, lng: branch.lng }, point));
  }

  /** Refuses a delivery beyond the radius or below the minimum basket. */
  assertDeliverable(zone: DeliveryZone, distanceMeters: number | null, basketMinor: number): void {
    const refusal = deliveryZoneRefusal(zone, distanceMeters, basketMinor);
    if (refusal === 'OUT_OF_ZONE') throw conflict('DELIVERY_OUT_OF_ZONE', 'Address is outside the delivery zone');
    if (refusal === 'BELOW_MINIMUM') throw conflict('MIN_BASKET_NOT_MET', 'Basket is below the delivery minimum');
  }

  async get(tenant: TenantContext): Promise<DeliveryZoneDTO> {
    const row = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: tenant.restaurantId },
      select: { deliveryZone: true },
    });
    const parsed = DeliveryZoneSchema.safeParse(row.deliveryZone);
    return {
      enabled: await this.features.isEnabled('delivery_zones', tenant.restaurantId),
      zone: row.deliveryZone !== null && parsed.success ? parsed.data : null,
    };
  }

  async set(tenant: TenantContext, actorUserId: string, input: UpdateDeliveryZoneInput): Promise<DeliveryZoneDTO> {
    await this.prisma.$transaction([
      this.prisma.restaurant.update({
        where: { id: tenant.restaurantId },
        data: { deliveryZone: input.zone === null ? Prisma.DbNull : (input.zone as Prisma.InputJsonValue) },
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId,
          restaurantId: tenant.restaurantId,
          action: 'restaurant.deliveryZone.update',
          entity: 'Restaurant',
          entityId: tenant.restaurantId,
          meta: { zone: input.zone } as Prisma.InputJsonValue,
        },
      }),
    ]);
    return this.get(tenant);
  }
}
