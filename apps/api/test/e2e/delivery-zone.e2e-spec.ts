import { Prisma } from '@resget/database';
import type { GeoPoint } from '@resget/shared';
import { GeocodingService } from '../../src/modules/geocoding/geocoding.service';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Delivery zone (docs/VITRIN.md, "Teslimat bölgesi"): radius, minimum basket and fee bands. */
describe('Delivery zone (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let itemId: string;
  let saved: { deliveryMode: 'RESTAURANT_COURIER' | 'THIRD_PARTY_API' | 'NONE'; deliveryFeePolicy: unknown };
  const created: string[] = [];

  // Seeded branch: 40.9867, 29.0263. About 0.5 km and 11 km away.
  const NEAR = { lat: 40.9905, lng: 29.0285 };
  const FAR = { lat: 41.08, lng: 29.0 };
  // About 3.5 km from the branch (second band) and 3 km from NEAR.
  const MIDDLE = { lat: 41.0182, lng: 29.0263 };
  // About 300 m from NEAR.
  const BESIDE_NEAR = { lat: 40.993, lng: 29.03 };
  /** What the address text geocodes to; by default the point the customer sent, so the two agree. */
  let geocoded: GeoPoint | null | 'SAME' = 'SAME';
  let phoneSeq = 0;
  let lastPoint: GeoPoint | null = null;
  const zone = {
    radiusMeters: 5000,
    minBasketMinor: 50000,
    bands: [
      { upToMeters: 2000, feeMinor: 1500 },
      { upToMeters: 5000, feeMinor: 3000 },
    ],
  };

  const owner = () => bearer(ownerToken, restaurantId);
  const setSwitch = (enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/delivery_zones`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const deliver = (point: { lat: number; lng: number } | null, quantity: number, expected: number) => {
    // A number of its own per order, so the open-order cap per phone never decides these cases.
    phoneSeq += 1;
    lastPoint = point;
    return ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .set('x-forwarded-for', `10.84.0.${phoneSeq}`)
      .send({
        fulfillment: 'DELIVERY',
        items: [{ menuItemId: itemId, quantity }],
        address: {
          addressLine: 'Moda Cad. No 21 D 3',
          city: 'Istanbul',
          district: 'Kadikoy',
          contactName: 'Bolge Musteri',
          contactPhone: `0532 998 ${String(phoneSeq).padStart(4, '0')}`,
          ...(point ? { point } : {}),
        },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(expected)
      .then(async (res) => {
        if (res.status === 201) {
          const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: res.body.trackingToken } });
          created.push(order.id);
        }
        return res;
      });
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, deliveryMode: true, deliveryFeePolicy: true },
    });
    restaurantId = restaurant.id;
    saved = { deliveryMode: restaurant.deliveryMode, deliveryFeePolicy: restaurant.deliveryFeePolicy };
    itemId = (await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, name: 'Izgara kofte' } })).id;
    // The address text geocodes to what each case says (the mock geocoder always answers near the branch).
    jest
      .spyOn(ctx.app.get(GeocodingService), 'pointFor')
      .mockImplementation(async () => (geocoded === 'SAME' ? lastPoint : geocoded));
    // Own couriers so the distance bands price the delivery.
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { deliveryMode: 'RESTAURANT_COURIER', deliveryFeePolicy: { mode: 'FIXED', feeMinor: 900 } },
    });
  });

  afterAll(async () => {
    await ctx.prisma.featureFlag.deleteMany({ where: { key: 'delivery_zones' } });
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        deliveryZone: Prisma.DbNull,
        deliveryMode: saved.deliveryMode,
        deliveryFeePolicy:
          saved.deliveryFeePolicy === null ? Prisma.DbNull : (saved.deliveryFeePolicy as Prisma.InputJsonValue),
      },
    });
    if (created.length) await ctx.prisma.order.deleteMany({ where: { id: { in: created } } });
    await ctx.prisma.auditLog.deleteMany({ where: { action: 'restaurant.deliveryZone.update' } });
    await ctx.close();
  });

  it('ships switched off: the zone screen is closed and delivery works as before', async () => {
    const refused = await ctx.http().get(`/restaurants/${restaurantId}/delivery-zone`).set(owner()).expect(403);
    expect(refused.body.code).toBe('FEATURE_DISABLED');
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { deliveryZone: zone } });
    const res = await deliver(FAR, 1, 201);
    expect(res.body.deliveryFeeMinor).toBe(900);
    const menu = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200);
    expect(menu.body.ordering.deliveryZone).toBeNull();
  });

  it('saves the zone and validates the bands', async () => {
    await setSwitch(true);
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/delivery-zone`)
      .set(owner())
      .send({ zone: { ...zone, bands: [{ upToMeters: 2000, feeMinor: 1 }] } })
      .expect(400);
    const saved = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/delivery-zone`)
      .set(owner())
      .send({ zone })
      .expect(200);
    expect(saved.body).toEqual({ enabled: true, zone });
    const menu = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200);
    expect(menu.body.ordering.deliveryZone).toEqual(zone);
  });

  it('refuses an address outside the radius and a basket below the minimum, prices by band', async () => {
    const far = await deliver(FAR, 2, 409);
    expect(far.body.code).toBe('DELIVERY_OUT_OF_ZONE');
    const small = await deliver(NEAR, 1, 409);
    expect(small.body.code).toBe('MIN_BASKET_NOT_MET');
    const near = await deliver(NEAR, 2, 201);
    expect(near.body.deliveryFeeMinor).toBe(1500);

    // Pickup is not a delivery: no radius and no minimum.
    const pickup = await ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 1 }],
        customer: { fullName: 'Gel Al', phone: '0532 999 09 32' },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(201);
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: pickup.body.trackingToken } });
    created.push(order.id);
  });

  it('refuses a delivery whose location cannot be established while the zone needs one', async () => {
    geocoded = null;
    try {
      const res = await deliver(null, 2, 409);
      expect(res.body.code).toBe('DELIVERY_LOCATION_REQUIRED');
    } finally {
      geocoded = 'SAME';
    }
  });

  it('checks the radius and prices on the geocoded address when the given point is far from it', async () => {
    try {
      // A point next to the branch for an address that geocodes outside the radius.
      geocoded = FAR;
      expect((await deliver(NEAR, 2, 409)).body.code).toBe('DELIVERY_OUT_OF_ZONE');
      // A point in the first band for an address in the second band pays the second band.
      geocoded = MIDDLE;
      expect((await deliver(NEAR, 2, 201)).body.deliveryFeeMinor).toBe(3000);
      // Within the tolerance the customer's own pin decides.
      geocoded = BESIDE_NEAR;
      const close = await deliver(NEAR, 2, 201);
      expect(close.body.deliveryFeeMinor).toBe(1500);
      const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: close.body.trackingToken } });
      expect((order.addressSnapshot as { point: GeoPoint }).point).toEqual(NEAR);
    } finally {
      geocoded = 'SAME';
    }
  });

  it('removes the zone with null', async () => {
    const cleared = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/delivery-zone`)
      .set(owner())
      .send({ zone: null })
      .expect(200);
    expect(cleared.body).toEqual({ enabled: true, zone: null });
    const res = await deliver(FAR, 1, 201);
    expect(res.body.deliveryFeeMinor).toBe(900);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'restaurant.deliveryZone.update', restaurantId } })).toBe(
      2,
    );
    await setSwitch(null);
  });

  it('refuses a courier network delivery without a location instead of pricing a zero quote', async () => {
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { deliveryMode: 'THIRD_PARTY_API' } });
    geocoded = null;
    try {
      const res = await deliver(null, 1, 409);
      expect(res.body.code).toBe('DELIVERY_LOCATION_REQUIRED');
    } finally {
      geocoded = 'SAME';
      await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { deliveryMode: 'RESTAURANT_COURIER' } });
    }
  });
});
