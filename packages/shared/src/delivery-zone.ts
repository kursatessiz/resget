import { z } from 'zod';
import { MinorAmountSchema } from './money';
import { customerDeliveryFee } from './courier';
import type { DeliveryFeePolicy } from './courier';

/**
 * Delivery zone (docs/VITRIN.md, "Teslimat bölgesi"): how far the restaurant
 * delivers from its branch, the smallest basket it delivers, and optionally a
 * fee by distance band for its own couriers. Behind the delivery_zones module
 * switch; while it is off delivery works as before (no radius, no minimum,
 * fee from the fee policy). Staff-entered orders are never refused.
 */

export const DELIVERY_RADIUS_MIN_METERS = 500;
export const DELIVERY_RADIUS_MAX_METERS = 50_000;
export const DELIVERY_BANDS_MAX = 8;

const BandSchema = z
  .object({
    upToMeters: z.number().int().min(100).max(DELIVERY_RADIUS_MAX_METERS),
    feeMinor: MinorAmountSchema,
  })
  .strict();

export const DeliveryZoneSchema = z
  .object({
    radiusMeters: z.number().int().min(DELIVERY_RADIUS_MIN_METERS).max(DELIVERY_RADIUS_MAX_METERS),
    /** Smallest basket (items, before the delivery fee) delivered; 0 means no minimum. */
    minBasketMinor: MinorAmountSchema,
    /** Own couriers only: the fee for each distance band, nearest first. Empty uses the fee policy. */
    bands: z.array(BandSchema).max(DELIVERY_BANDS_MAX),
  })
  .strict()
  .refine((zone) => zone.bands.every((band, i) => i === 0 || band.upToMeters > zone.bands[i - 1].upToMeters), {
    message: 'Bands grow outwards',
    path: ['bands'],
  })
  .refine((zone) => zone.bands.length === 0 || zone.bands[zone.bands.length - 1].upToMeters >= zone.radiusMeters, {
    message: 'The last band reaches the radius',
    path: ['bands'],
  });
export type DeliveryZone = z.infer<typeof DeliveryZoneSchema>;

/** Saving the zone: a zone, or null to remove it (delivery then has no radius or minimum). */
export const UpdateDeliveryZoneSchema = z.object({ zone: DeliveryZoneSchema.nullable() }).strict();
export type UpdateDeliveryZoneInput = z.infer<typeof UpdateDeliveryZoneSchema>;

export interface DeliveryZoneDTO {
  /** The module is on for the restaurant; when false the zone is stored but not applied. */
  enabled: boolean;
  zone: DeliveryZone | null;
}

export type DeliveryZoneRefusal = 'OUT_OF_ZONE' | 'BELOW_MINIMUM';

/**
 * Whether a delivery to this distance with this basket is accepted. A
 * distance of null (no point for the address) is not refused here; the API
 * geocodes before it asks.
 */
export function deliveryZoneRefusal(
  zone: DeliveryZone,
  distanceMeters: number | null,
  basketMinor: number,
): DeliveryZoneRefusal | null {
  if (distanceMeters !== null && distanceMeters > zone.radiusMeters) return 'OUT_OF_ZONE';
  if (zone.minBasketMinor > 0 && basketMinor < zone.minBasketMinor) return 'BELOW_MINIMUM';
  return null;
}

/**
 * The own-courier fee with a zone: the band the distance falls in, then the
 * policy's free-above threshold still applies. Without bands, or without a
 * distance, the fee policy decides as before.
 */
export function zoneDeliveryFee(
  zone: DeliveryZone,
  distanceMeters: number | null,
  basketMinor: number,
  policy: DeliveryFeePolicy | null,
): number {
  const fromPolicy = policy ? customerDeliveryFee(0, basketMinor, policy) : 0;
  if (zone.bands.length === 0 || distanceMeters === null) return fromPolicy;
  if (policy?.mode === 'FREE_ABOVE' && basketMinor >= policy.thresholdMinor) return 0;
  const band = zone.bands.find((b) => distanceMeters <= b.upToMeters) ?? zone.bands[zone.bands.length - 1];
  return band.feeMinor;
}
