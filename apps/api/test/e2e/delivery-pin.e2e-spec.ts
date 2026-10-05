import { normalizePhone } from '@resget/shared';
import type { DeliveryTripDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const COURIER_PHONE = normalizePhone('05320000004')!;
const NOTE = 'e2e-delivery-pin';

/** Proof of delivery (docs/TESLIMAT_KODU.md): the customer's code, attempts and the staff override. */
describe('Delivery code (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let courierToken: string;
  let restaurantId: string;
  let branchId: string;
  let itemId: string;
  let courierMembershipId: string;
  let tripId: string;
  const orders: Array<{ id: string; token: string }> = [];
  let stopOf: Record<string, string> = {};
  const owner = () => bearer(ownerToken);
  const courierBase = () => `/restaurants/${restaurantId}/courier/me/trips/${tripId}`;
  const deliver = (orderId: string, body: object, expected: number) =>
    ctx
      .http()
      .post(`${courierBase()}/stops/${stopOf[orderId]}/deliver`)
      .set(bearer(courierToken))
      .send(body)
      .expect(expected);
  const tracking = async (token: string) => (await ctx.http().get(`/public/orders/${token}`).expect(200)).body;

  const readyOrder = async (name: string, lat: number) => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'DELIVERY',
        items: [{ menuItemId: itemId, quantity: 1 }],
        address: {
          addressLine: `${name} Sok. No 3`,
          city: 'Istanbul',
          district: 'Kadikoy',
          contactName: name,
          contactPhone: '0532 999 02 00',
          point: { lat, lng: 29.03 },
        },
        deliveryFeeMinor: 1500,
        note: NOTE,
      })
      .expect(201);
    for (const to of ['ACCEPTED', 'PREPARING', 'READY']) {
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/orders/${res.body.id}/transition`)
        .set(owner())
        .send({ to, ...(to === 'ACCEPTED' ? { prepMinutes: 10 } : {}) })
        .expect(200);
    }
    return { id: res.body.id as string, token: (res.body.trackingUrl as string).split('/t/')[1] };
  };

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
    [adminToken, ownerToken, courierToken] = await Promise.all([
      ctx.login(SEED.superAdminPhone),
      ctx.login(SEED.ownerPhone),
      ctx.login(COURIER_PHONE),
    ]);
  });

  afterAll(async () => {
    if (tripId) await ctx.prisma.deliveryTrip.deleteMany({ where: { id: tripId } });
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'delivery_pin' } });
    await ctx.close();
  });

  it('gives every delivery order a code but shows it only while the module is on', async () => {
    orders.push(
      await readyOrder('Pin Bir', 40.988),
      await readyOrder('Pin Iki', 40.993),
      await readyOrder('Pin Uc', 40.996),
    );
    const stored = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orders[0].id } });
    expect(stored.deliveryCode).toMatch(/^\d{4}$/);
    expect((await tracking(orders[0].token)).deliveryCode).toBeNull();
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/delivery_pin`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    expect((await tracking(orders[0].token)).deliveryCode).toBe(stored.deliveryCode);
  });

  it('asks the courier for the code and accepts only the right one', async () => {
    const trip = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/dispatch/trips`)
        .set(owner())
        .send({ orderIds: orders.map((o) => o.id), courierMembershipId })
        .expect(201)
    ).body as DeliveryTripDTO;
    tripId = trip.id;
    stopOf = Object.fromEntries(trip.stops.map((s) => [s.orderId, s.id]));
    await ctx.http().post(`${courierBase()}/pickup`).set(bearer(courierToken)).expect(200);
    await ctx.http().post(`${courierBase()}/start`).set(bearer(courierToken)).expect(200);

    const [first] = orders;
    const code = (await ctx.prisma.order.findUniqueOrThrow({ where: { id: first.id } })).deliveryCode as string;
    const wrong = code === '0000' ? '1111' : '0000';
    expect((await deliver(first.id, {}, 400)).headers['x-error-code']).toBe('DELIVERY_CODE_REQUIRED');
    await deliver(first.id, { code: 'abcd' }, 400);
    expect((await deliver(first.id, { code: wrong }, 400)).headers['x-error-code']).toBe('DELIVERY_CODE_INVALID');
    const done = (await deliver(first.id, { code }, 200)).body as DeliveryTripDTO;
    expect(done.stops.find((s) => s.orderId === first.id)).toMatchObject({ status: 'DELIVERED', proof: 'PIN' });
    const after = await tracking(first.token);
    expect(after.status).toBe('DELIVERED');
    expect(after.deliveryCode).toBeNull();
  });

  it('lets the courier deliver an order placed before codes existed', async () => {
    const legacy = orders[2];
    await ctx.prisma.order.update({ where: { id: legacy.id }, data: { deliveryCode: null } });
    expect((await tracking(legacy.token)).deliveryCode).toBeNull();
    const done = (await deliver(legacy.id, {}, 200)).body as DeliveryTripDTO;
    expect(done.stops.find((s) => s.orderId === legacy.id)).toMatchObject({ status: 'DELIVERED', proof: null });
  });

  it('locks the code after too many wrong tries and lets staff deliver without it', async () => {
    const second = orders[1];
    const code = (await ctx.prisma.order.findUniqueOrThrow({ where: { id: second.id } })).deliveryCode as string;
    const wrong = code === '0000' ? '1111' : '0000';
    // Parallel guesses share the same limit: never more than five reach the code check.
    const guesses = await Promise.all(
      Array.from({ length: 8 }, () =>
        ctx
          .http()
          .post(`${courierBase()}/stops/${stopOf[second.id]}/deliver`)
          .set(bearer(courierToken))
          .send({ code: wrong }),
      ),
    );
    expect(guesses.filter((r) => r.status === 400)).toHaveLength(5);
    expect(guesses.filter((r) => r.status === 409)).toHaveLength(3);
    const locked = await deliver(second.id, { code }, 409);
    expect(locked.headers['x-error-code']).toBe('DELIVERY_CODE_LOCKED');
    const trip = (
      await ctx.http().get(`/restaurants/${restaurantId}/dispatch/trips/${tripId}`).set(owner()).expect(200)
    ).body as DeliveryTripDTO;
    expect(trip.stops.find((s) => s.orderId === second.id)?.codeLocked).toBe(true);

    const staff = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/dispatch/trips/${tripId}/stops/${stopOf[second.id]}/deliver`)
        .set(owner())
        .send({})
        .expect(200)
    ).body as DeliveryTripDTO;
    expect(staff.stops.find((s) => s.orderId === second.id)).toMatchObject({ status: 'DELIVERED', proof: 'STAFF' });
    expect(staff.status).toBe('COMPLETED');
  });
});
