import type { ChurnCustomerDTO, ChurnOverviewDTO, RestaurantHealthPageDTO, SegmentPreviewDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { deleteTestRestaurants } from './support/cleanup';

const DAY_MS = 86_400_000;
const LOCAL_PHONES = ['05329990981', '05329990982', '05329990983', '05329990984', '05329990985'];
/** Stored as the order endpoint normalises them, so an order finds the same user. */
const PHONES = LOCAL_PHONES.map((phone) => `+90${phone.slice(1)}`);

/** Churn risk (docs/KAYIP_RISKI.md): switches, classes against each rhythm, reset on order, segment field, console health. */
describe('Churn risk (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let menuItemId: string;
  let newRestaurantId: string | null = null;
  const orderIds: string[] = [];
  const customers: Record<string, string> = {};
  const owner = () => bearer(ownerToken, restaurantId);
  const base = () => `/restaurants/${restaurantId}/churn`;
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
  const riskOf = async (key: string) =>
    (
      await ctx.prisma.restaurantCustomer.findUniqueOrThrow({
        where: { id: customers[key] },
        select: { churnRisk: true },
      })
    ).churnRisk;

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, branches: { take: 1, select: { id: true } } },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    menuItemId = (
      await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, isAvailable: true }, select: { id: true } })
    ).id;
    await ctx.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    const people = [
      // Weekly for a month, then 20 quiet days: at risk.
      { key: 'weekly', orderCount: 5, firstOrderAt: daysAgo(48), lastOrderAt: daysAgo(20), lifetimeGrossMinor: 90000 },
      // Monthly, 40 quiet days: still regular.
      {
        key: 'monthly',
        orderCount: 4,
        firstOrderAt: daysAgo(130),
        lastOrderAt: daysAgo(40),
        lifetimeGrossMinor: 50000,
      },
      // One order 40 days ago: did not return.
      { key: 'once', orderCount: 1, firstOrderAt: daysAgo(40), lastOrderAt: daysAgo(40), lifetimeGrossMinor: 12000 },
      // Nothing for 150 days: lost.
      { key: 'gone', orderCount: 3, firstOrderAt: daysAgo(200), lastOrderAt: daysAgo(150), lifetimeGrossMinor: 30000 },
      // A prospect who never ordered: no class.
      { key: 'prospect', orderCount: 0, firstOrderAt: null, lastOrderAt: null, lifetimeGrossMinor: 0 },
    ];
    for (const [i, { key, ...fields }] of people.entries()) {
      const user = await ctx.prisma.user.create({ data: { phone: PHONES[i], fullName: `Kayip ${key}` } });
      const row = await ctx.prisma.restaurantCustomer.create({
        data: { restaurantId, userId: user.id, ...fields },
        select: { id: true },
      });
      customers[key] = row.id;
    }
  });

  afterAll(async () => {
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { id: { in: Object.values(customers) } } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    if (newRestaurantId) await deleteTestRestaurants(ctx.prisma, { id: newRestaurantId });
    await ctx.prisma.featureFlag.deleteMany({
      where: { OR: [{ key: 'restaurant_health' }, { restaurantId, key: { in: ['churn_signals', 'segments_v2'] } }] },
    });
    await ctx.close();
  });

  it('is behind its switch, in the panel and in segments', async () => {
    await ctx.http().get(`${base()}/overview`).set(owner()).expect(403).expect('x-error-code', 'FEATURE_DISABLED');
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/segments_v2`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/segments/preview`)
      .set(owner())
      .send({ rule: { op: 'AND', rules: [{ field: 'churnRisk', op: 'in', value: ['AT_RISK'] }] } })
      .expect(403)
      .expect('x-error-code', 'FEATURE_DISABLED');
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/churn_signals`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
  });

  it('classes each customer against their own rhythm', async () => {
    const overview = (await ctx.http().get(`${base()}/overview`).set(owner()).expect(200)).body as ChurnOverviewDTO;
    expect(overview.currency).toMatch(/^[A-Z]{3}$/);
    expect(await riskOf('weekly')).toBe('AT_RISK');
    expect(await riskOf('monthly')).toBe('ACTIVE');
    expect(await riskOf('once')).toBe('NOT_RETURNED');
    expect(await riskOf('gone')).toBe('LOST');
    expect(await riskOf('prospect')).toBeNull();

    const stored = await ctx.prisma.restaurantCustomer.count({
      where: { restaurantId, churnRisk: 'AT_RISK', user: { deletedAt: null } },
    });
    expect(overview.counts.AT_RISK).toBe(stored);
    expect(overview.atRiskLifetimeGrossMinor).toBeGreaterThanOrEqual(90000);

    const atRisk = (await ctx.http().get(`${base()}/customers`).set(owner()).expect(200)).body as ChurnCustomerDTO[];
    const weekly = atRisk.find((c) => c.id === customers.weekly);
    expect(weekly).toMatchObject({
      risk: 'AT_RISK',
      orderCount: 5,
      usualIntervalDays: 7,
      daysSinceLastOrder: 20,
      phone: '+905329990981',
    });
    const once = (await ctx.http().get(`${base()}/customers?risk=NOT_RETURNED`).set(owner()).expect(200))
      .body as ChurnCustomerDTO[];
    expect(once.find((c) => c.id === customers.once)?.usualIntervalDays).toBeNull();
    await ctx.http().get(`${base()}/customers?risk=ACTIVE`).set(owner()).expect(400);
  });

  it('targets a class from a segment', async () => {
    const preview = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/segments/preview`)
        .set(owner())
        .send({ rule: { op: 'AND', rules: [{ field: 'churnRisk', op: 'in', value: ['NOT_RETURNED', 'LOST'] }] } })
        .expect(200)
    ).body as SegmentPreviewDTO;
    const expected = await ctx.prisma.restaurantCustomer.count({
      where: { restaurantId, churnRisk: { in: ['NOT_RETURNED', 'LOST'] }, user: { deletedAt: null } },
    });
    expect(preview.count).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(2);
  });

  it('brings an at-risk customer back with their next order', async () => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity: 1 }],
        customer: { fullName: 'Kayip weekly', phone: LOCAL_PHONES[0] },
      })
      .expect(201);
    orderIds.push(res.body.id as string);
    expect(await riskOf('weekly')).toBe('ACTIVE');
  });

  it('lists restaurants with a health signal in the console', async () => {
    const health = () => ctx.http().get('/admin/restaurant-health').set(bearer(adminToken));
    await health().expect(403).expect('x-error-code', 'FEATURE_DISABLED');
    await ctx.http().get('/admin/restaurant-health').set(owner()).expect(403);
    await ctx
      .http()
      .put('/admin/features/restaurant_health')
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);

    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { currency: true, countryCode: true, timezone: true },
    });
    newRestaurantId = (
      await ctx.prisma.restaurant.create({
        data: {
          slug: `churn-e2e-${Date.now().toString(36)}`,
          name: 'Sessiz Yeni',
          countryCode: restaurant.countryCode,
          currency: restaurant.currency,
          timezone: restaurant.timezone,
          createdAt: daysAgo(20),
        },
        select: { id: true },
      })
    ).id;

    const page = (await health().expect(200)).body as RestaurantHealthPageDTO;
    expect(page.checked).toBeGreaterThanOrEqual(2);
    const quiet = page.items.find((item) => item.id === newRestaurantId);
    expect(quiet).toMatchObject({ level: 'MEDIUM', signals: ['NEVER_ORDERED'], lastOrderAt: null });
    expect(page.items.some((item) => item.id === restaurantId && item.signals.includes('NEVER_ORDERED'))).toBe(false);
    expect(page.counts.MEDIUM).toBeGreaterThanOrEqual(1);
  });
});
