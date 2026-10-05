import { normalizePhone } from '@resget/shared';
import type { DeliveryTripDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const COURIER_PHONE = normalizePhone('05320000004')!;
const NOTE = 'e2e-trip-kitchen-ready';

/** An order planned into a trip before it was cooked still gets READY from the kitchen (docs/SIPARIS_VE_SEVK.md). */
describe('Kitchen READY for an order already in a trip (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let courierToken: string;
  let restaurantId: string;
  let branchId: string;
  let itemId: string;
  let courierMembershipId: string;
  let tripId: string | null = null;
  const owner = () => bearer(ownerToken);
  const transition = (orderId: string, body: Record<string, unknown>) =>
    ctx.http().post(`/restaurants/${restaurantId}/orders/${orderId}/transition`).set(owner()).send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true, menuItems: true },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    itemId = restaurant.menuItems.find((m) => m.name === 'Izgara kofte')!.id;
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    courierMembershipId = (
      await ctx.prisma.membership.findFirstOrThrow({ where: { restaurantId, user: { phone: COURIER_PHONE } } })
    ).id;
    [ownerToken, courierToken] = await Promise.all([ctx.login(SEED.ownerPhone), ctx.login(COURIER_PHONE)]);
  });

  afterAll(async () => {
    if (tripId) await ctx.prisma.deliveryTrip.deleteMany({ where: { id: tripId } });
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.close();
  });

  it('lets the kitchen finish a planned order, then the trip takes over', async () => {
    const order = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'DELIVERY',
        items: [{ menuItemId: itemId, quantity: 1 }],
        address: {
          addressLine: 'Plan Sok. No 1',
          city: 'Istanbul',
          district: 'Kadikoy',
          contactName: 'Plan Musteri',
          contactPhone: '0532 999 03 00',
          point: { lat: 40.99, lng: 29.03 },
        },
        deliveryFeeMinor: 1500,
        note: NOTE,
      })
      .expect(201);
    const orderId = order.body.id as string;
    await transition(orderId, { to: 'ACCEPTED', prepMinutes: 10 }).expect(200);
    const trip = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/dispatch/trips`)
        .set(owner())
        .send({ orderIds: [orderId], courierMembershipId })
        .expect(201)
    ).body as DeliveryTripDTO;
    tripId = trip.id;
    const base = `/restaurants/${restaurantId}/courier/me/trips/${trip.id}`;
    // Not cooked yet: the courier cannot take it.
    await ctx.http().post(`${base}/pickup`).set(bearer(courierToken)).expect(409);

    await transition(orderId, { to: 'PREPARING' }).expect(200);
    await transition(orderId, { to: 'READY' }).expect(200);
    await ctx.http().post(`${base}/pickup`).set(bearer(courierToken)).expect(200);
    await ctx.http().post(`${base}/start`).set(bearer(courierToken)).expect(200);

    // On the road, READY means a failed stop and stays with the trip.
    const back = await transition(orderId, { to: 'READY' }).expect(409);
    expect(back.headers['x-error-code']).toBe('ORDER_IN_TRIP');
  });
});
