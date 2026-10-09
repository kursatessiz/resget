import { Prisma } from '@resget/database';
import { WEEKDAY_KEYS, localClock } from '@resget/shared';
import type { OrderDetailDTO, StorefrontDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const MIN = 60_000;
const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Scheduled orders (docs/ILERI_TARIHLI_SIPARIS.md): slots, pre-orders while closed, accept alarm, promised time. */
describe('Scheduled orders (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let timezone: string;
  let itemId: string;
  let savedHours: unknown;
  const created: string[] = [];
  const owner = () => bearer(ownerToken, restaurantId);
  const setSwitch = (key: string, enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/${key}`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const storefront = async () =>
    (await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200)).body as StorefrontDTO;
  const place = (fields: Record<string, unknown>, expected: number) =>
    ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 1 }],
        customer: { fullName: 'Planli Musteri', phone: '05329990931' },
        payment: { method: 'CASH_ON_DELIVERY' },
        ...fields,
      })
      .expect(expected)
      .then(async (res) => {
        if (res.status === 201) {
          const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: res.body.trackingToken } });
          created.push(order.id);
          return { res, order };
        }
        return { res, order: null };
      });

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: {
        id: true,
        timezone: true,
        branches: { where: { isActive: true }, orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });
    restaurantId = restaurant.id;
    timezone = restaurant.timezone;
    branchId = restaurant.branches[0].id;
    savedHours = restaurant.branches[0].openingHours;
    itemId = (await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, name: 'Izgara kofte' } })).id;

    // One three-hour window that starts at least two hours from now: closed now, open later.
    const clock = localClock(new Date(), timezone);
    let start = Math.ceil((clock.minutes + 120) / 60) * 60;
    let day = WEEKDAY_KEYS.indexOf(clock.day);
    // A window that would run past midnight moves to the next day, never to a negative minute.
    if (start + 180 > 1440) {
      start = Math.max(0, start - 1440);
      day = (day + 1) % 7;
    }
    await ctx.prisma.branch.update({
      where: { id: branchId },
      data: { openingHours: { [WEEKDAY_KEYS[day]]: [[hhmm(start), hhmm(start + 180)]] } },
    });
  });

  afterAll(async () => {
    if (created.length) await ctx.prisma.order.deleteMany({ where: { id: { in: created } } });
    await ctx.prisma.featureFlag.deleteMany({
      where: { restaurantId, key: { in: ['scheduled_orders', 'order_availability'] } },
    });
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { schedulingSettings: Prisma.DbNull, ordersPausedUntil: null },
    });
    await ctx.prisma.branch.update({
      where: { id: branchId },
      data: { openingHours: savedHours === null ? Prisma.DbNull : (savedHours as Prisma.InputJsonValue) },
    });
    await ctx.prisma.auditLog.deleteMany({ where: { restaurantId, action: 'scheduling.update' } });
    await ctx.close();
  });

  it('is behind its switch and offers nothing until the restaurant turns it on', async () => {
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/scheduling`)
      .set(owner())
      .expect(403)
      .expect('x-error-code', 'FEATURE_DISABLED');
    expect((await storefront()).scheduling).toBeNull();
    await setSwitch('scheduled_orders', true);
    await setSwitch('order_availability', true);
    const settings = await ctx.http().get(`/restaurants/${restaurantId}/scheduling`).set(owner()).expect(200);
    expect(settings.body).toMatchObject({ enabled: false, slotMinutes: 30 });
    expect((await storefront()).scheduling).toBeNull();
    await place({ scheduledFor: new Date(Date.now() + 3 * 3_600_000).toISOString() }, 409).then(({ res }) =>
      expect(res.headers['x-error-code']).toBe('SCHEDULING_UNAVAILABLE'),
    );

    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/scheduling`)
      .set(owner())
      .send({ enabled: true, slotMinutes: 15, minLeadMinutes: 30, maxDaysAhead: 2, deliveryLeadMinutes: 20 })
      .expect(200);
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/scheduling`)
      .set(owner())
      .send({ enabled: true, slotMinutes: 20 })
      .expect(400);
  });

  it('takes a pre-order for an offered slot while closed, and refuses anything else', async () => {
    const page = await storefront();
    expect(page.availability).toMatchObject({ accepting: false, state: 'CLOSED' });
    expect(page.scheduling?.slots.length).toBeGreaterThan(0);
    await place({}, 409).then(({ res }) => expect(res.headers['x-error-code']).toBe('RESTAURANT_NOT_ACCEPTING'));

    const slot = page.scheduling?.slots[2] as string;
    const off = new Date(new Date(slot).getTime() + 7 * MIN).toISOString();
    await place({ scheduledFor: off }, 400).then(({ res }) =>
      expect(res.headers['x-error-code']).toBe('SCHEDULED_SLOT_INVALID'),
    );

    const { order } = await place({ scheduledFor: slot }, 201);
    expect(order?.status).toBe('PLACED');
    expect(order?.scheduledFor?.toISOString()).toBe(slot);
    // Default prep 20 and timeout 10: the alarm rings 30 minutes before the slot, not 10 minutes from now.
    expect(order?.acceptDeadlineAt?.toISOString()).toBe(new Date(new Date(slot).getTime() - 30 * MIN).toISOString());

    const tracking = await ctx.http().get(`/public/orders/${order?.trackingToken}`).expect(200);
    expect(tracking.body.scheduledFor).toBe(slot);
  });

  it('promises the slot on accept and shows it on the panel', async () => {
    const id = created[created.length - 1];
    const detail = (await ctx.http().get(`/restaurants/${restaurantId}/orders/${id}`).set(owner()).expect(200))
      .body as OrderDetailDTO;
    const slot = detail.scheduledFor as string;
    expect(slot).not.toBeNull();
    const accepted = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${id}/transition`)
      .set(owner())
      .send({ to: 'ACCEPTED', prepMinutes: 15 })
      .expect(200);
    expect(accepted.body.promisedReadyAt).toBe(slot);
    expect(accepted.body.acceptDeadlineAt).toBeNull();
  });

  it('refuses a slot while a pause lasts past it, and never schedules a table order', async () => {
    const page = await storefront();
    const slot = page.scheduling?.slots[0] as string;
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { ordersPausedUntil: new Date(new Date(slot).getTime() + 60 * MIN) },
    });
    await place({ scheduledFor: slot }, 409).then(({ res }) =>
      expect(res.headers['x-error-code']).toBe('RESTAURANT_NOT_ACCEPTING'),
    );
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { ordersPausedUntil: null } });
    await place({ fulfillment: 'DINE_IN', customer: undefined, scheduledFor: slot }, 400);
  });
});
