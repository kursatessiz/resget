import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const COURIER_PHONE = normalizePhone('05320000004')!;
const COUNTER_PHONE = '+905329990111';
const MANAGER_PHONE = '+905329990112';
const HIDDEN_PHONE = '+905320771234';
const HIGH_PHONE = '+905329990113';
const CUSTOMER_PHONE_DIGITS = '905329990100';
const NOTE = 'e2e-staff-data';
const POINT = { lat: 40.988, lng: 29.027 };

/** Staff-facing data exposure and the role hierarchy (docs/PANEL.md, docs/SIPARIS_VE_SEVK.md, docs/PERSONEL.md). */
describe('Staff data exposure and role hierarchy (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let branchId: string;
  let kofteId: string;
  let ownerToken: string;
  let counterToken: string;
  let courierToken: string;
  let managerToken: string;
  let courierMembershipId: string;
  const tripIds: string[] = [];
  const createdRoleIds: string[] = [];
  const phones = [COUNTER_PHONE, MANAGER_PHONE, HIGH_PHONE, HIDDEN_PHONE];

  const createOrder = async () => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken))
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'DELIVERY',
        items: [{ menuItemId: kofteId, quantity: 1 }],
        address: {
          addressLine: 'Gizli Sok. No 1 D 2',
          city: 'Istanbul',
          district: 'Kadikoy',
          contactName: 'Gizli Musteri',
          contactPhone: '0532 999 01 00',
          point: POINT,
        },
        deliveryFeeMinor: 1500,
        note: NOTE,
      })
      .expect(201);
    return res.body as { id: string; trackingUrl: string };
  };

  const transition = (orderId: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${orderId}/transition`)
      .set(bearer(ownerToken))
      .send({ to, ...extra })
      .expect(200);

  const readyOrder = async () => {
    const order = await createOrder();
    await transition(order.id, 'ACCEPTED', { prepMinutes: 10 });
    await transition(order.id, 'PREPARING');
    await transition(order.id, 'READY');
    return order;
  };

  const seedUser = async (
    phone: string,
    fullName: string,
    roleTemplateId: string,
    status: 'ACTIVE' | 'PASSIVE' = 'ACTIVE',
  ) => {
    const user = await ctx.prisma.user.create({ data: { phone, fullName } });
    const membership = await ctx.prisma.membership.create({
      data: { userId: user.id, restaurantId, roleTemplateId, status, joinedAt: new Date() },
    });
    return membership.id;
  };

  const cleanup = async () => {
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    if (tripIds.length > 0) await ctx.prisma.deliveryTrip.deleteMany({ where: { id: { in: tripIds } } });
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { restaurantId, user: { phone: HIDDEN_PHONE } } });
    await ctx.prisma.courierLocation.deleteMany({ where: { restaurantId } });
    await ctx.prisma.otpCode.deleteMany({ where: { phone: { in: phones } } });
    await ctx.prisma.membership.deleteMany({ where: { user: { phone: { in: phones } } } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: phones } } });
    await ctx.prisma.roleTemplate.deleteMany({ where: { restaurantId, name: { startsWith: 'E2E Hiyerarsi' } } });
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true, menuItems: true },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    kofteId = restaurant.menuItems.find((m) => m.name === 'Izgara kofte')!.id;
    await cleanup();

    const counterRole = await ctx.prisma.roleTemplate.findFirstOrThrow({
      where: { restaurantId, templateKey: 'counter' },
    });
    await seedUser(COUNTER_PHONE, 'E2E Kasa', counterRole.id);

    // A shift manager: staff.manage and a few reads, nothing financial.
    const managerRole = await ctx.prisma.roleTemplate.create({
      data: {
        restaurantId,
        name: 'E2E Hiyerarsi Sorumlu',
        isOwner: false,
        permissions: { create: ['staff.manage', 'orders.view'].map((permissionKey) => ({ permissionKey })) },
      },
    });
    createdRoleIds.push(managerRole.id);
    await seedUser(MANAGER_PHONE, 'E2E Sorumlu', managerRole.id);

    courierMembershipId = (
      await ctx.prisma.membership.findFirstOrThrow({ where: { restaurantId, user: { phone: COURIER_PHONE } } })
    ).id;
    [ownerToken, courierToken, counterToken, managerToken] = await Promise.all([
      ctx.login(SEED.ownerPhone),
      ctx.login(COURIER_PHONE),
      ctx.login(COUNTER_PHONE),
      ctx.login(MANAGER_PHONE),
    ]);
  });

  afterAll(async () => {
    await cleanup();
    await ctx.close();
  });

  // -- resget:customers/phone-search-oracle-defeats-contact-masking ---------------------------

  it('does not let a search without contact rights probe the masked part of a phone number', async () => {
    const user = await ctx.prisma.user.create({ data: { phone: HIDDEN_PHONE, fullName: 'Gizli Numara' } });
    await ctx.prisma.restaurantCustomer.create({ data: { restaurantId, userId: user.id } });
    const search = (token: string, query: string) =>
      ctx
        .http()
        .get(`/restaurants/${restaurantId}/customers?query=${encodeURIComponent(query)}`)
        .set(bearer(token))
        .expect(200);

    // The counter role sees +9053*****34 and nothing more.
    const masked = await search(counterToken, 'Gizli Num');
    expect(masked.body.items[0].phone).toMatch(/^\+9053\*+34$/);
    // Digits that only occur in the hidden middle part must not match.
    const probe = await search(counterToken, '0771');
    expect(probe.body.total).toBe(0);
    expect(probe.body.items).toEqual([]);
    const probeWithPlus = await search(counterToken, '+905320771234');
    expect(probeWithPlus.body.total).toBe(0);
    // Name search still works for them, and so does the visible prefix.
    expect((await search(counterToken, 'Gizli Num')).body.total).toBe(1);

    // The owner holds customers.contact.view: phone search keeps working.
    const owner = await search(ownerToken, '0771');
    expect(owner.body.total).toBe(1);
    expect(owner.body.items[0].phone).toBe(HIDDEN_PHONE);
  });

  // -- resget:dispatch/trip-dto-unmasked-customer-contact -------------------------------------

  it('masks the customer phone on trip stops for staff without contact rights, everywhere a trip is read', async () => {
    const order = await readyOrder();
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/dispatch/trips`)
      .set(bearer(ownerToken))
      .send({ orderIds: [order.id], courierMembershipId })
      .expect(201);
    const tripId = created.body.id as string;
    tripIds.push(tripId);
    // The owner holds customers.contact.view and sees the full number.
    expect(created.body.stops[0].address.contactPhone).toBe(`+${CUSTOMER_PHONE_DIGITS}`);

    const leaks = (body: unknown) => JSON.stringify(body).includes(CUSTOMER_PHONE_DIGITS);
    const base = `/restaurants/${restaurantId}/dispatch`;
    const list = await ctx.http().get(`${base}/trips`).set(bearer(counterToken)).expect(200);
    expect(list.body.length).toBeGreaterThan(0);
    expect(leaks(list.body)).toBe(false);
    const one = await ctx.http().get(`${base}/trips/${tripId}`).set(bearer(counterToken)).expect(200);
    expect(one.body.stops[0].address.contactPhone).toMatch(/^\+9053\*+00$/);
    expect(leaks(one.body)).toBe(false);
    const board = await ctx.http().get(`${base}/board`).set(bearer(counterToken)).expect(200);
    expect(board.body.activeTrips.some((t: { id: string }) => t.id === tripId)).toBe(true);
    expect(leaks(board.body.activeTrips)).toBe(false);
    // A mutation answers with the same masked trip.
    const optimized = await ctx.http().post(`${base}/trips/${tripId}/optimize`).set(bearer(counterToken)).expect(200);
    expect(leaks(optimized.body)).toBe(false);
    // The address itself stays: dispatchers route by it.
    expect(one.body.stops[0].address.addressLine).toBe('Gizli Sok. No 1 D 2');

    // The owner still sees everything through the same reads.
    const ownerView = await ctx.http().get(`${base}/trips/${tripId}`).set(bearer(ownerToken)).expect(200);
    expect(ownerView.body.stops[0].address.contactPhone).toBe(`+${CUSTOMER_PHONE_DIGITS}`);

    // The assigned courier keeps the number they need to call the customer (separate courier endpoints).
    const mine = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/courier/me/trips/${tripId}`)
      .set(bearer(courierToken))
      .expect(200);
    expect(mine.body.stops[0].address.contactPhone).toBe(`+${CUSTOMER_PHONE_DIGITS}`);
  });

  it('masks the customer phone in trip.updated events of the staff stream', async () => {
    const order = await readyOrder();
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/dispatch/trips`)
      .set(bearer(ownerToken))
      .send({ orderIds: [order.id], courierMembershipId })
      .expect(201);
    const tripId = created.body.id as string;
    tripIds.push(tripId);

    const server = ctx.app.getHttpServer() as http.Server;
    if (!server.listening) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const frames: string[] = [];
    let buffer = '';
    const request = http.get(
      {
        host: '127.0.0.1',
        port,
        path: `/restaurants/${restaurantId}/dispatch/events`,
        headers: { accept: 'text/event-stream', ...bearer(counterToken) },
      },
      (res) => {
        expect(res.statusCode).toBe(200);
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          frames.push(...parts.filter(Boolean));
        });
      },
    );
    const waitFor = (predicate: () => boolean) =>
      new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          if (predicate()) return resolve();
          if (Date.now() - started > 10_000) return reject(new Error(`no matching frame in ${frames.length}`));
          setTimeout(tick, 50);
        };
        tick();
      });
    try {
      // Give the stream a moment to subscribe, then change the trip as the owner.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/dispatch/trips/${tripId}/optimize`)
        .set(bearer(ownerToken))
        .expect(200);
      await waitFor(() => frames.some((f) => f.includes('event: trip.updated')));
      const tripFrames = frames.filter((f) => f.includes('event: trip.updated'));
      expect(tripFrames.length).toBeGreaterThan(0);
      for (const frame of tripFrames) expect(frame).not.toContain(CUSTOMER_PHONE_DIGITS);
      const orderFrames = frames.filter((f) => f.includes('event: order.updated'));
      for (const frame of orderFrames) expect(frame).not.toContain(CUSTOMER_PHONE_DIGITS);
    } finally {
      request.destroy();
    }
  });

  // -- resget:orders/staff-order-detail-exposes-tracking-token-and-delivery-pin ------------------

  it('keeps the customer tracking link out of order detail for roles without contact rights', async () => {
    const order = await createOrder();
    const token = order.trackingUrl.split('/t/')[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const read = (bearerToken: string) =>
      ctx.http().get(`/restaurants/${restaurantId}/orders/${order.id}`).set(bearer(bearerToken)).expect(200);

    // Owner and managers (customers.contact.view) keep it: it is how a phone order is handed to the customer.
    const ownerView = await read(ownerToken);
    expect(ownerView.body.trackingUrl).toBe(order.trackingUrl);
    // Counter and courier roles hold orders.view only and never receive the bearer token.
    for (const roleToken of [counterToken, courierToken]) {
      const view = await read(roleToken);
      expect(view.body.trackingUrl).toBeUndefined();
      expect(JSON.stringify(view.body)).not.toContain(token);
    }
  });

  it('keeps the tracking link out of the courier collect response', async () => {
    const order = await readyOrder();
    const token = order.trackingUrl.split('/t/')[1];
    const trip = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/dispatch/trips`)
      .set(bearer(ownerToken))
      .send({ orderIds: [order.id], courierMembershipId })
      .expect(201);
    tripIds.push(trip.body.id as string);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/trips/${trip.body.id}/start`)
      .set(bearer(courierToken))
      .expect(200);
    const collected = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/trips/${trip.body.id}/stops/${trip.body.stops[0].id}/collect`)
      .set(bearer(courierToken))
      .send({ method: 'CASH_ON_DELIVERY' })
      .expect(200);
    expect(collected.body.trackingUrl).toBeUndefined();
    expect(JSON.stringify(collected.body)).not.toContain(token);
  });

  // -- resget:staff.updateMember:status-only-change-skips-grantable-and-rank-check --------------

  it('applies the hierarchy check to status-only changes of a member whose role outranks the caller', async () => {
    const highRole = await ctx.prisma.roleTemplate.create({
      data: {
        restaurantId,
        name: 'E2E Hiyerarsi Yuksek',
        isOwner: false,
        permissions: {
          create: ['orders.view', 'payments.manage', 'roles.manage'].map((permissionKey) => ({ permissionKey })),
        },
      },
    });
    createdRoleIds.push(highRole.id);
    const lowRole = await ctx.prisma.roleTemplate.create({
      data: {
        restaurantId,
        name: 'E2E Hiyerarsi Dusuk',
        isOwner: false,
        permissions: { create: [{ permissionKey: 'orders.view' }] },
      },
    });
    createdRoleIds.push(lowRole.id);
    // The owner disabled a financial manager on purpose; a shift manager must not be able to bring them back.
    const highMembershipId = await seedUser(HIGH_PHONE, 'E2E Mali Yonetici', highRole.id, 'PASSIVE');
    const lowUser = await ctx.prisma.user.create({
      data: { phone: `${HIGH_PHONE.slice(0, -1)}4`, fullName: 'E2E Dusuk' },
    });
    const lowMembership = await ctx.prisma.membership.create({
      data: { userId: lowUser.id, restaurantId, roleTemplateId: lowRole.id, status: 'ACTIVE', joinedAt: new Date() },
    });
    phones.push(lowUser.phone);
    const patch = (token: string, membershipId: string, body: Record<string, unknown>) =>
      ctx.http().patch(`/restaurants/${restaurantId}/staff/members/${membershipId}`).set(bearer(token)).send(body);

    await patch(managerToken, highMembershipId, { status: 'ACTIVE' })
      .expect(403)
      .expect('x-error-code', 'ROLE_ESCALATION');
    expect((await ctx.prisma.membership.findUniqueOrThrow({ where: { id: highMembershipId } })).status).toBe('PASSIVE');

    // Locking out a more privileged peer is refused the same way.
    await ctx.prisma.membership.update({ where: { id: highMembershipId }, data: { status: 'ACTIVE' } });
    await patch(managerToken, highMembershipId, { status: 'PASSIVE' })
      .expect(403)
      .expect('x-error-code', 'ROLE_ESCALATION');
    expect((await ctx.prisma.membership.findUniqueOrThrow({ where: { id: highMembershipId } })).status).toBe('ACTIVE');

    // A member whose role the manager could hand out is still theirs to manage, and the owner is never limited.
    await patch(managerToken, lowMembership.id, { status: 'PASSIVE' }).expect(200);
    await patch(ownerToken, lowMembership.id, { status: 'ACTIVE' }).expect(200);
    await patch(ownerToken, highMembershipId, { status: 'PASSIVE' }).expect(200);
  });
});
