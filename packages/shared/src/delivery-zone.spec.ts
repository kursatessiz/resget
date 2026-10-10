import {
  DELIVERY_POINT_MAX_DRIFT_METERS,
  DeliveryZoneSchema,
  deliveryPricingPoint,
  deliveryZoneRefusal,
  zoneDeliveryFee,
} from './delivery-zone';
import { haversineMeters } from './delivery';

const zone = {
  radiusMeters: 5000,
  minBasketMinor: 15000,
  bands: [
    { upToMeters: 2000, feeMinor: 1000 },
    { upToMeters: 5000, feeMinor: 2500 },
  ],
};

describe('delivery zone', () => {
  it('refuses beyond the radius and below the minimum, in that order', () => {
    expect(deliveryZoneRefusal(zone, 1200, 20000)).toBeNull();
    expect(deliveryZoneRefusal(zone, 5001, 20000)).toBe('OUT_OF_ZONE');
    expect(deliveryZoneRefusal(zone, 5001, 100)).toBe('OUT_OF_ZONE');
    expect(deliveryZoneRefusal(zone, 1200, 14999)).toBe('BELOW_MINIMUM');
    expect(deliveryZoneRefusal({ ...zone, minBasketMinor: 0 }, 1200, 1)).toBeNull();
    expect(deliveryZoneRefusal(zone, null, 20000)).toBeNull();
  });

  it('prices by band, keeps free-above, and falls back to the policy', () => {
    expect(zoneDeliveryFee(zone, 1500, 20000, { mode: 'FIXED', feeMinor: 700 })).toBe(1000);
    expect(zoneDeliveryFee(zone, 2001, 20000, { mode: 'FIXED', feeMinor: 700 })).toBe(2500);
    expect(zoneDeliveryFee(zone, 3000, 50000, { mode: 'FREE_ABOVE', thresholdMinor: 40000, feeMinor: 700 })).toBe(0);
    expect(zoneDeliveryFee({ ...zone, bands: [] }, 3000, 20000, { mode: 'FIXED', feeMinor: 700 })).toBe(700);
    expect(zoneDeliveryFee(zone, null, 20000, { mode: 'FIXED', feeMinor: 700 })).toBe(700);
    expect(zoneDeliveryFee(zone, 3000, 20000, null)).toBe(2500);
  });

  it('validates bands growing outwards up to the radius', () => {
    expect(DeliveryZoneSchema.safeParse(zone).success).toBe(true);
    expect(DeliveryZoneSchema.safeParse({ ...zone, bands: [] }).success).toBe(true);
    expect(DeliveryZoneSchema.safeParse({ ...zone, bands: [...zone.bands].reverse() }).success).toBe(false);
    expect(DeliveryZoneSchema.safeParse({ ...zone, bands: [{ upToMeters: 2000, feeMinor: 1 }] }).success).toBe(false);
    expect(DeliveryZoneSchema.safeParse({ ...zone, radiusMeters: 100 }).success).toBe(false);
  });

  it('prices on the customer pin unless the address text geocodes too far from it', () => {
    const pin = { lat: 40.9905, lng: 29.0285 };
    const beside = { lat: 40.993, lng: 29.03 };
    const far = { lat: 41.08, lng: 29.0 };
    expect(haversineMeters(pin, beside)).toBeLessThan(DELIVERY_POINT_MAX_DRIFT_METERS);
    expect(deliveryPricingPoint(pin, beside)).toEqual(pin);
    expect(deliveryPricingPoint(pin, far)).toEqual(far);
    expect(deliveryPricingPoint(pin, null)).toEqual(pin);
    expect(deliveryPricingPoint(null, far)).toEqual(far);
    expect(deliveryPricingPoint(null, null)).toBeNull();
  });
});
