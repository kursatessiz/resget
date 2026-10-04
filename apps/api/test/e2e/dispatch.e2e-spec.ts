import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const COURIER_PHONE = normalizePhone('05320000004')!;
const COUNTER_PHONE = '+905329990101';
const NOTE = 'e2e-dispatch';
const BRANCH = { lat: 40.9867, lng: 29.0263 };
const NEAR = { lat: 40.988, lng: 29.027 };
const MID = { lat: 40.993, lng: 29.03 };
const FAR = { lat: 41.0, lng: 29.035 };

interface Created {
  id: string;
  status: string;
  trackingUrl: string;
  activeTrip: { tripId: string; stopId: string; sequence: number } | null;
}

describe('Orders, dispatch, courier and tracking (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let branchId: string;
  let kofteId: string;
  let ayranId: string;
  let ownerToken: string;
  let courierToken: string;
  let counterToken: string;
  let courierMembershipId: string;
  const tripIds: string[] = [];

  const address = (point: { lat: number; lng: number }, name: string) => ({
    addressLine: `${name} Sok. No 1 D 2`,
    city: 'Istanbul',
    district: 'Kadikoy',
    contactName: name,
    contactPhone: '0532 999 01 00',
    point,
  });

  const createOrder = async (
    point: { lat: number; lng: number },
    name: string,
    items = [{ menuItemId: kofteId, quantity: 1 }],
  ) => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken))
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'DELIVERY',
        items,
        address: address(point, name),
        deliveryFeeMinor: 1500,
        note: NOTE,
      })
      .expect(201);
    return res.body as Created;
  };

  const transition = (orderId: string, to: string, extra: Record<string, unknown> = {}, expected = 200) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${orderId}/transition`)
      .set(bearer(ownerToken))
      .send({ to, ...extra })
      .expect(expected);

  const readyOrder = async (point: { lat: number; lng: number }, name: string): Promise<Created> => {
    const order = await createOrder(point, name);
    await transition(order.id, 'ACCEPTED', { prepMinutes: 10 });
    await transition(order.id, 'PREPARING');
    await transition(order.id, 'READY');
    return order;
  };

  const getOrder = async (orderId: string) =>
    (await ctx.http().get(`/restaurants/${restaurantId}/orders/${orderId}`).set(bearer(ownerToken)).expect(200)).body;
  const tokenOf = (order: Created) => order.trackingUrl.split('/t/')[1];
  const tracking = async (order: Created) =>
    (
      await ctx
        .http()
        .get(`/public/orders/${tokenOf(order)}`)
        .expect(200)
    ).body;
  const trip = async (tripId: string) =>
    (await ctx.http().get(`/restaurants/${restaurantId}/dispatch/trips/${tripId}`).set(bearer(ownerToken)).expect(200))
      .body;

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true, menuItems: true },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    kofteId = restaurant.menuItems.find((m) => m.name === 'Izgara kofte')!.id;
    ayranId = restaurant.menuItems.find((m) => m.name === 'Ayran')!.id;
    // Leftovers of an earlier run against the same database.
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.deliveryTrip.deleteMany({ where: { restaurantId, stops: { none: {} } } });
    await ctx.prisma.courierLocation.deleteMany({ where: { restaurantId } });
    await ctx.prisma.otpCode.deleteMany({ where: { phone: COUNTER_PHONE } });
    await ctx.prisma.user.deleteMany({ where: { phone: COUNTER_PHONE } });
    const counterRole = await ctx.prisma.roleTemplate.findFirstOrThrow({
      where: { restaurantId, templateKey: 'counter' },
    });
    const counter = await ctx.prisma.user.create({ data: { phone: COUNTER_PHONE, fullName: 'E2E Kasa' } });
    await ctx.prisma.membership.create({
      data: {
        userId: counter.id,
        restaurantId,
        roleTemplateId: counterRole.id,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    courierMembershipId = (
      await ctx.prisma.membership.findFirstOrThrow({ where: { restaurantId, user: { phone: COURIER_PHONE } } })
    ).id;
    [ownerToken, courierToken, counterToken] = await Promise.all([
      ctx.login(SEED.ownerPhone),
      ctx.login(COURIER_PHONE),
      ctx.login(COUNTER_PHONE),
    ]);
  });

  afterAll(async () => {
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    if (tripIds.length > 0) await ctx.prisma.deliveryTrip.deleteMany({ where: { id: { in: tripIds } } });
    await ctx.prisma.courierLocation.deleteMany({ where: { restaurantId } });
    await ctx.prisma.otpCode.deleteMany({ where: { phone: COUNTER_PHONE } });
    await ctx.prisma.user.deleteMany({ where: { phone: COUNTER_PHONE } });
    await ctx.close();
  });

  let first: Created;
  let near: Created;
  let mid: Created;
  let far: Created;
  let tripId: string;
  let stopIds: Record<string, string>;

  it('creates a delivery order with the settlement snapshot, a tracking link and the customer on file', async () => {
    first = await createOrder(NEAR, 'Ayse', [
      { menuItemId: kofteId, quantity: 2 },
      { menuItemId: ayranId, quantity: 1 },
    ]);
    expect(first.status).toBe('PLACED');
    expect(first.trackingUrl).toMatch(/\/t\/[A-Za-z0-9_-]{20,}$/);
    const detail = await getOrder(first.id);
    expect(detail.itemCount).toBe(3);
    expect(detail.chargedToCustomerMinor).toBe(42000 * 2 + 4000 + 1500);
    expect(detail.platformReceivableMinor).toBeGreaterThan(0);
    expect(detail.customer.phone).toBe('+905329990100');
    expect(detail.history.map((h: { to: string }) => h.to)).toEqual(['PLACED']);
    const list = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/orders?active=true`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(list.body.some((o: { id: string }) => o.id === first.id)).toBe(true);
  });

  it('masks the customer phone for staff without customers.contact.view', async () => {
    const res = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/orders/${first.id}`)
      .set(bearer(counterToken))
      .expect(200);
    expect(res.body.customer.phone).toMatch(/^\+9053\*+00$/);
    expect(res.body.address.contactPhone).not.toBe('+905329990100');
  });

  it('walks the kitchen states and refuses transitions the state machine does not allow', async () => {
    const accepted = await transition(first.id, 'ACCEPTED', { prepMinutes: 15 });
    expect(accepted.body.status).toBe('ACCEPTED');
    expect(new Date(accepted.body.promisedReadyAt).getTime()).toBeGreaterThan(Date.now() + 10 * 60_000);
    const invalid = await transition(first.id, 'DELIVERED', {}, 409);
    expect(invalid.body.code).toBe('ORDER_TRANSITION_INVALID');
    await transition(first.id, 'PREPARING');
    const ready = await transition(first.id, 'READY');
    expect(ready.body.readyAt).toBeTruthy();
    const snapshot = await tracking(first);
    expect(snapshot.status).toBe('READY');
    expect(snapshot.courier).toBeNull();
    expect(snapshot.items).toEqual([
      { name: 'Izgara kofte', quantity: 2 },
      { name: 'Ayran', quantity: 1 },
    ]);
    await ctx
      .http()
      .get(`/public/orders/${'x'.repeat(24)}`)
      .expect(404);
  });

  it('ignores courier positions while no trip is active', async () => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/location`)
      .set(bearer(courierToken))
      .send({ points: [{ ...BRANCH, recordedAt: new Date().toISOString() }] })
      .expect(200);
    expect(res.body.tracked).toBe(false);
    expect(await ctx.prisma.courierLocation.count({ where: { membershipId: courierMembershipId } })).toBe(0);
  });

  it('lets only dispatch staff create a trip, and orders the stops by the shortest route', async () => {
    near = first;
    mid = await readyOrder(MID, 'Mehmet');
    far = await readyOrder(FAR, 'Zeynep');
    const refused = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/dispatch/trips`)
      .set(bearer(courierToken))
      .send({ orderIds: [near.id] })
      .expect(403);
    expect(refused.body.code).toBe('FORBIDDEN');

    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/dispatch/trips`)
      .set(bearer(ownerToken))
      .send({ orderIds: [far.id, near.id, mid.id], sequenceMode: 'OPTIMIZED', courierMembershipId })
      .expect(201);
    tripId = created.body.id as string;
    tripIds.push(tripId);
    expect(created.body.status).toBe('ASSIGNED');
    expect(created.body.sequenceMode).toBe('OPTIMIZED');
    expect(created.body.stops.map((s: { orderId: string }) => s.orderId)).toEqual([near.id, mid.id, far.id]);
    expect(created.body.stops.map((s: { sequence: number }) => s.sequence)).toEqual([1, 2, 3]);
    expect(created.body.plannedDistanceMeters).toBeGreaterThan(1000);
    expect(created.body.stops[2].etaAt).toBeTruthy();
    stopIds = Object.fromEntries(created.body.stops.map((s: { orderId: string; id: string }) => [s.orderId, s.id]));

    const again = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/dispatch/trips`)
      .set(bearer(ownerToken))
      .send({ orderIds: [near.id] })
      .expect(409);
    expect(again.body.code).toBe('ORDER_NOT_DISPATCHABLE');

    const board = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/dispatch/board`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(board.body.readyOrders.some((o: { id: string }) => [near.id, mid.id, far.id].includes(o.id))).toBe(false);
    expect(board.body.activeTrips.some((t: { id: string }) => t.id === tripId)).toBe(true);
    const courier = board.body.couriers.find((c: { membershipId: string }) => c.membershipId === courierMembershipId);
    expect(courier.activeTripId).toBe(tripId);
    expect((await getOrder(near.id)).activeTrip).toEqual(expect.objectContaining({ tripId, sequence: 1 }));
  });

  it('reorders stops by hand and back to the shortest route', async () => {
    const manual = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/dispatch/trips/${tripId}/sequence`)
      .set(bearer(ownerToken))
      .send({ stopIds: [stopIds[mid.id], stopIds[near.id], stopIds[far.id]] })
      .expect(200);
    expect(manual.body.sequenceMode).toBe('MANUAL');
    expect(manual.body.stops.map((s: { orderId: string }) => s.orderId)).toEqual([mid.id, near.id, far.id]);
    const bad = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/dispatch/trips/${tripId}/sequence`)
      .set(bearer(ownerToken))
      .send({ stopIds: [stopIds[mid.id]] })
      .expect(409);
    expect(bad.body.code).toBe('TRIP_STOP_INVALID');
    const optimized = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/dispatch/trips/${tripId}/optimize`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(optimized.body.stops.map((s: { orderId: string }) => s.orderId)).toEqual([near.id, mid.id, far.id]);
  });

  it('refuses the courier leg through the order endpoint while the order rides in a trip', async () => {
    const res = await transition(near.id, 'OUT_FOR_DELIVERY', {}, 409);
    expect(res.body.code).toBe('ORDER_IN_TRIP');
  });

  it('courier picks up and departs: orders are handed over, then on the way with an estimate', async () => {
    const mine = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/courier/me/trips`)
      .set(bearer(courierToken))
      .expect(200);
    expect(mine.body.map((t: { id: string }) => t.id)).toContain(tripId);
    // The courier's map starts at the branch the orders are picked up from.
    expect(mine.body.find((t: { id: string }) => t.id === tripId).pickupPoint).toEqual(BRANCH);
    const board = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/dispatch/board`)
      .set(bearer(courierToken))
      .expect(403);
    expect(board.body.code).toBe('FORBIDDEN');

    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/trips/${tripId}/pickup`)
      .set(bearer(courierToken))
      .expect(200);
    expect((await getOrder(near.id)).status).toBe('HANDED_TO_COURIER');
    expect((await tracking(far)).status).toBe('HANDED_TO_COURIER');

    const started = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/trips/${tripId}/start`)
      .set(bearer(courierToken))
      .expect(200);
    expect(started.body.status).toBe('IN_PROGRESS');
    expect(started.body.stops[0].status).toBe('EN_ROUTE');
    expect(started.body.stops[1].status).toBe('PENDING');
    const farOrder = await getOrder(far.id);
    expect(farOrder.status).toBe('OUT_FOR_DELIVERY');
    expect(farOrder.estimatedDeliveryAt).toBeTruthy();
    const farTracking = await tracking(far);
    expect(farTracking.courier.firstName).toBe('Demo');
    expect(farTracking.courier.stopsAhead).toBe(2);
    expect(farTracking.courier.position).toBeNull();
  });

  it('a position inside the arrival radius turns the current stop to ARRIVING and refreshes every estimate', async () => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/location`)
      .set(bearer(courierToken))
      .send({
        points: [
          { ...BRANCH, recordedAt: new Date(Date.now() - 60_000).toISOString(), speedMps: 6 },
          { lat: NEAR.lat + 0.0003, lng: NEAR.lng, recordedAt: new Date().toISOString(), speedMps: 2, headingDeg: 10 },
        ],
      })
      .expect(200);
    expect(res.body.tracked).toBe(true);
    expect(res.body.arrived).toBe(true);
    expect(res.body.currentStopId).toBe(stopIds[near.id]);
    expect(res.body.stops).toHaveLength(3);
    expect((await getOrder(near.id)).status).toBe('ARRIVING');
    const nearTracking = await tracking(near);
    expect(nearTracking.courier.position.lat).toBeCloseTo(NEAR.lat + 0.0003, 4);
    expect(nearTracking.courier.distanceMeters).toBeLessThan(150);
    expect(nearTracking.courier.stopsAhead).toBe(0);
    expect((await tracking(mid)).courier.stopsAhead).toBe(1);
    expect(await ctx.prisma.courierLocationSample.count({ where: { tripId } })).toBe(2);
  });

  it('delivering advances to the next stop, a failed stop returns its order, and the trip completes', async () => {
    const delivered = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/trips/${tripId}/stops/${stopIds[near.id]}/deliver`)
      .set(bearer(courierToken))
      .expect(200);
    expect(delivered.body.stops.find((s: { orderId: string }) => s.orderId === near.id).status).toBe('DELIVERED');
    expect(delivered.body.stops.find((s: { orderId: string }) => s.orderId === mid.id).status).toBe('EN_ROUTE');
    const nearOrder = await getOrder(near.id);
    expect(nearOrder.status).toBe('DELIVERED');
    expect(nearOrder.completedAt).toBeTruthy();
    expect(nearOrder.activeTrip).toBeNull();

    const failed = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/trips/${tripId}/stops/${stopIds[mid.id]}/fail`)
      .set(bearer(courierToken))
      .send({ reason: 'Kapi acilmadi' })
      .expect(200);
    expect(failed.body.stops.find((s: { orderId: string }) => s.orderId === mid.id).failureReason).toBe(
      'Kapi acilmadi',
    );
    expect(failed.body.stops.find((s: { orderId: string }) => s.orderId === far.id).status).toBe('EN_ROUTE');
    const midOrder = await getOrder(mid.id);
    expect(midOrder.status).toBe('READY');
    expect(midOrder.activeTrip).toBeNull();
    expect(midOrder.history.at(-1)).toEqual(
      expect.objectContaining({ from: 'OUT_FOR_DELIVERY', to: 'READY', reason: 'Kapi acilmadi' }),
    );

    const done = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/trips/${tripId}/stops/${stopIds[far.id]}/deliver`)
      .set(bearer(courierToken))
      .expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.completedAt).toBeTruthy();
    const location = await ctx.prisma.courierLocation.findUniqueOrThrow({
      where: { membershipId: courierMembershipId },
    });
    expect(location.tripId).toBeNull();
    const board = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/dispatch/board`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(board.body.activeTrips.some((t: { id: string }) => t.id === tripId)).toBe(false);
    expect(board.body.readyOrders.some((o: { id: string }) => o.id === mid.id)).toBe(true);
    expect((await trip(tripId)).status).toBe('COMPLETED');
  });

  it('cancelling a trip after pickup returns the orders to the dispatch queue', async () => {
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/dispatch/trips`)
      .set(bearer(ownerToken))
      .send({ orderIds: [mid.id], courierMembershipId })
      .expect(201);
    tripIds.push(created.body.id);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/dispatch/trips/${created.body.id}/pickup`)
      .set(bearer(ownerToken))
      .expect(200);
    expect((await getOrder(mid.id)).status).toBe('HANDED_TO_COURIER');
    const cancelled = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/dispatch/trips/${created.body.id}/cancel`)
      .set(bearer(ownerToken))
      .send({ reason: 'Kurye hastalandi' })
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    const midOrder = await getOrder(mid.id);
    expect(midOrder.status).toBe('READY');
    expect(midOrder.activeTrip).toBeNull();
    const nothing = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/trips/${created.body.id}/start`)
      .set(bearer(courierToken))
      .expect(409);
    expect(nothing.body.code).toBe('TRIP_STATE_INVALID');
  });

  it('streams the tracking snapshot and live updates over SSE', async () => {
    const server = ctx.app.getHttpServer() as http.Server;
    if (!server.listening) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const frames: string[] = [];
    let buffer = '';
    const request = http.get(
      {
        host: '127.0.0.1',
        port,
        path: `/public/orders/${tokenOf(mid)}/events`,
        headers: { accept: 'text/event-stream' },
      },
      (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/event-stream');
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          frames.push(...parts.filter(Boolean));
        });
      },
    );
    const waitFor = (count: number) =>
      new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          if (frames.length >= count) return resolve();
          if (Date.now() - started > 10_000) return reject(new Error(`only ${frames.length} frames`));
          setTimeout(tick, 50);
        };
        tick();
      });
    try {
      await waitFor(1);
      expect(frames[0]).toContain('event: tracking.updated');
      expect(frames[0]).toContain('"status":"READY"');
      await transition(mid.id, 'CANCELLED_BY_RESTAURANT', { reason: 'Adres bulunamadi' });
      await waitFor(2);
      expect(frames[1]).toContain('"status":"CANCELLED_BY_RESTAURANT"');
      expect(frames[1]).toMatch(/^id: \d+/m);
    } finally {
      request.destroy();
    }
  });
});
