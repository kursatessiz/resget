import { Prisma } from '@resget/database';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Order availability (docs/SIPARIS_VE_SEVK.md, "Sipariş alma durumu"): pause, busy mode, opening hours. */
describe('Order availability (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let itemId: string;
  let savedHours: unknown;
  const created: string[] = [];

  const setSwitch = (enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/order_availability`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const owner = () => bearer(ownerToken, restaurantId);
  const placePickup = (expected: number) =>
    ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 1 }],
        customer: { fullName: 'Durum Musteri', phone: '05329990921' },
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
  const alwaysOpen = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, [['00:00', '24:00']]]),
  );

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, branches: { where: { isActive: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    savedHours = restaurant.branches[0].openingHours;
    itemId = (await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, name: 'Izgara kofte' } })).id;
  });

  afterAll(async () => {
    await ctx.prisma.featureFlag.deleteMany({ where: { key: 'order_availability' } });
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { ordersPausedUntil: null, busyExtraMinutes: 0, busyUntil: null },
    });
    await ctx.prisma.branch.update({
      where: { id: branchId },
      data: { openingHours: savedHours === null ? Prisma.DbNull : (savedHours as Prisma.InputJsonValue) },
    });
    if (created.length) await ctx.prisma.order.deleteMany({ where: { id: { in: created } } });
    await ctx.prisma.auditLog.deleteMany({ where: { action: 'restaurant.availability.update' } });
    await ctx.close();
  });

  it('ships switched off: nothing changes and the panel cannot pause', async () => {
    const state = await ctx.http().get(`/restaurants/${restaurantId}/availability`).set(owner()).expect(200);
    expect(state.body).toMatchObject({ enabled: false, accepting: true, state: 'OPEN' });
    const refused = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/availability`)
      .set(owner())
      .send({ pause: { minutes: 30 } })
      .expect(403);
    expect(refused.body.code).toBe('FEATURE_DISABLED');
  });

  it('edits opening hours, refuses another restaurant branch and bad windows', async () => {
    const saved = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/opening-hours`)
      .set(owner())
      .send({ branchId, hours: alwaysOpen })
      .expect(200);
    expect(saved.body[0]).toMatchObject({ branchId, hours: alwaysOpen });
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/opening-hours`)
      .set(owner())
      .send({ branchId: '00000000-0000-4000-8000-000000000000', hours: null })
      .expect(404);
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/opening-hours`)
      .set(owner())
      .send({ branchId, hours: { mon: [['10:00', '10:00']] } })
      .expect(400);
  });

  it('pauses consumer orders, keeps staff orders and resumes', async () => {
    await setSwitch(true);
    const paused = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/availability`)
      .set(owner())
      .send({ pause: { minutes: 30 } })
      .expect(200);
    expect(paused.body).toMatchObject({ enabled: true, accepting: false, state: 'PAUSED' });
    const menu = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200);
    expect(menu.body.availability).toMatchObject({ accepting: false, state: 'PAUSED' });
    const refused = await placePickup(409);
    expect(refused.body.code).toBe('RESTAURANT_NOT_ACCEPTING');

    // The person at the till still enters a phone order.
    const staff = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 1 }],
        customer: { fullName: 'Telefon Musteri', phone: '05329990922' },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(201);
    created.push(staff.body.id as string);

    await ctx.http().put(`/restaurants/${restaurantId}/availability`).set(owner()).send({ pause: null }).expect(200);
    await placePickup(201);
    const audit = await ctx.prisma.auditLog.count({
      where: { action: 'restaurant.availability.update', restaurantId },
    });
    expect(audit).toBe(2);
  });

  it('busy mode shows the extra minutes on the menu until it is turned off', async () => {
    const busy = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/availability`)
      .set(owner())
      .send({ busy: { extraMinutes: 20, minutes: 60 } })
      .expect(200);
    expect(busy.body).toMatchObject({ accepting: true, busyExtraMinutes: 20 });
    const menu = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200);
    expect(menu.body.availability.busyExtraMinutes).toBe(20);
    const off = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/availability`)
      .set(owner())
      .send({ busy: null })
      .expect(200);
    expect(off.body).toMatchObject({ busyExtraMinutes: 0, busyUntil: null });
  });

  it('refuses consumer orders outside the opening hours and names the next opening', async () => {
    // Open only on a day that is not today in the restaurant's zone.
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    const today = new Intl.DateTimeFormat('en-US', { timeZone: restaurant.timezone, weekday: 'short' })
      .format(new Date())
      .toLowerCase()
      .slice(0, 3);
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const other = days[(days.indexOf(today) + 3) % 7];
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/opening-hours`)
      .set(owner())
      .send({ branchId, hours: { [other]: [['10:00', '12:00']] } })
      .expect(200);
    const menu = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200);
    expect(menu.body.availability).toMatchObject({ accepting: false, state: 'CLOSED' });
    expect(new Date(menu.body.availability.nextOpenAt as string).getTime()).toBeGreaterThan(Date.now());
    const refused = await placePickup(409);
    expect(refused.body.code).toBe('RESTAURANT_NOT_ACCEPTING');

    // With the module off again the hours no longer refuse orders.
    await setSwitch(null);
    await placePickup(201);
  });
});
