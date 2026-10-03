import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Address geocoding (docs/VITRIN.md): a delivery address without a point gets one near the branch, best effort. */
describe('Geocoding (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let restaurantId: string;
  let branch: { id: string; lat: number | null; lng: number | null };
  let menuItemId: string;
  const orderIds: string[] = [];
  const address = {
    addressLine: 'Bahariye Cad. No 44 D 2',
    city: 'Istanbul',
    district: 'Kadikoy',
    contactName: 'Geokod Musteri',
    contactPhone: '05329990951',
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    ownerToken = await ctx.login(SEED.ownerPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, branches: { take: 1, select: { id: true, lat: true, lng: true } } },
    });
    restaurantId = restaurant.id;
    branch = restaurant.branches[0];
    menuItemId = (
      await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, isAvailable: true }, select: { id: true } })
    ).id;
  });

  afterAll(async () => {
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.close();
  });

  it('places a public delivery order and a staff order near the branch when no point was given', async () => {
    expect(branch.lat).not.toBeNull();
    const placed = await ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'DELIVERY',
        items: [{ menuItemId, quantity: 1 }],
        address,
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(201);
    const publicOrder = await ctx.prisma.order.findUniqueOrThrow({
      where: { trackingToken: placed.body.trackingToken },
      select: { id: true, addressSnapshot: true },
    });
    orderIds.push(publicOrder.id);
    const snapshot = publicOrder.addressSnapshot as { point: { lat: number; lng: number } | null };
    expect(snapshot.point).not.toBeNull();
    expect(Math.abs(snapshot.point!.lat - branch.lat!)).toBeLessThan(0.01);
    expect(Math.abs(snapshot.point!.lng - branch.lng!)).toBeLessThan(0.01);

    const staff = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken, restaurantId))
      .send({
        branchId: branch.id,
        channel: 'PHONE',
        fulfillment: 'DELIVERY',
        items: [{ menuItemId, quantity: 1 }],
        address: { ...address, addressLine: 'Moda Cad. No 7' },
      })
      .expect(201);
    orderIds.push(staff.body.id as string);
    const staffOrder = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: staff.body.id as string },
      select: { addressSnapshot: true },
    });
    expect((staffOrder.addressSnapshot as { point: unknown }).point).not.toBeNull();

    // A point the customer gave is never overwritten.
    const given = await ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'DELIVERY',
        items: [{ menuItemId, quantity: 1 }],
        address: { ...address, point: { lat: 41.1, lng: 29.1 } },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(201);
    const givenOrder = await ctx.prisma.order.findUniqueOrThrow({
      where: { trackingToken: given.body.trackingToken },
      select: { id: true, addressSnapshot: true },
    });
    orderIds.push(givenOrder.id);
    expect((givenOrder.addressSnapshot as { point: { lat: number } }).point.lat).toBe(41.1);
  });
});
