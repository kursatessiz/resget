import { normalizePhone, ordersPerRestaurantPerDay } from '@resget/shared';
import type { PlatformKpiDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { deleteTestRestaurants } from './support/cleanup';

const VIEWER_PHONE = normalizePhone('05329990991')!;
const BUYER_PHONE = normalizePhone('05329990992')!;
const LEAD_PHONE = normalizePhone('05329990993')!;

/** A fixed-offset zone where it is now around noon: inside the demo branch's opening hours. */
function noonZone(now: Date): string {
  const offset = 12 - now.getUTCHours();
  if (offset === 0) return 'Etc/UTC';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/** The platform funnels and KPI board (docs/HUNILER.md): access, module switch, totals only. */
describe('Platform KPI board (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let platformId: string;
  let restaurantId: string;
  let originalTimezone: string;
  let signupId: string | null = null;
  const orderIds: string[] = [];
  const sessions = [`kpi-e2e-${Date.now()}-a`, `kpi-e2e-${Date.now()}-b`];
  const board = async (token: string, days = 30) =>
    (await ctx.http().get(`/platform/kpi?days=${days}`).set(bearer(token)).expect(200)).body as PlatformKpiDTO;

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    await deleteTestRestaurants(ctx.prisma, { isPlatform: true });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: [VIEWER_PHONE, BUYER_PHONE, LEAD_PHONE] } } });
    const setup = await ctx
      .http()
      .post('/admin/platform/setup')
      .set(bearer(adminToken))
      .send({ name: 'Platform', countryCode: 'TR', currency: 'TRY', timezone: 'Europe/Istanbul', defaultLocale: 'tr' })
      .expect(200);
    platformId = setup.body.tenant.id as string;
    await ctx
      .http()
      .put('/admin/features/marketing_platform')
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, timezone: true },
    });
    restaurantId = restaurant.id;
    originalTimezone = restaurant.timezone;
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { timezone: noonZone(new Date()) } });
  });

  afterAll(async () => {
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.prisma.qrScanEvent.deleteMany({ where: { sessionId: { in: sessions } } });
    if (signupId) await deleteTestRestaurants(ctx.prisma, { id: signupId });
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { user: { phone: { in: [BUYER_PHONE, LEAD_PHONE] } } } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: [VIEWER_PHONE, BUYER_PHONE, LEAD_PHONE] } } });
    await ctx.prisma.featureFlag.deleteMany({ where: { key: { in: ['marketing_platform', 'kpi_dashboard'] } } });
    await deleteTestRestaurants(ctx.prisma, { isPlatform: true });
    await ctx.prisma.auditLog.deleteMany({ where: { action: { startsWith: 'platform.' } } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { timezone: originalTimezone } });
    await ctx.close();
  });

  it('is for platform marketing users and behind its own switch', async () => {
    await ctx
      .http()
      .get('/platform/kpi')
      .set(bearer(ownerToken))
      .expect(403)
      .expect('x-error-code', 'PLATFORM_ACCESS_DENIED');
    await ctx
      .http()
      .get('/platform/kpi')
      .set(bearer(adminToken))
      .expect(403)
      .expect('x-error-code', 'FEATURE_DISABLED');
    await ctx
      .http()
      .put(`/admin/restaurants/${platformId}/features/kpi_dashboard`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    await ctx
      .http()
      .post('/admin/platform/users')
      .set(bearer(adminToken))
      .send({ phone: VIEWER_PHONE, fullName: 'Pano Izleyici', role: 'marketing_viewer' })
      .expect(200);
    const viewer = await board(await ctx.login(VIEWER_PHONE), 7);
    expect(viewer.days).toBe(7);
    expect(viewer.daily.length).toBeGreaterThanOrEqual(7);
    await ctx.http().get('/platform/kpi?days=5').set(bearer(adminToken)).expect(400);
  });

  it('counts orders, money, funnels and districts without exposing anyone', async () => {
    const before = await board(adminToken);

    // A sale on the demo restaurant.
    const menuItem = await ctx.prisma.menuItem.findFirstOrThrow({
      where: { restaurantId, isAvailable: true },
      select: { id: true },
    });
    const placed = await ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
        customer: { fullName: 'Pano Alici', phone: BUYER_PHONE },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(201);
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { trackingToken: (placed.body as { trackingToken: string }).trackingToken },
      select: { id: true, itemsGrossMinor: true, platformCommissionMinor: true, currency: true, channel: true },
    });
    orderIds.push(order.id);

    // Two anonymous table QR sessions: both open the menu, one starts an order.
    await ctx.prisma.qrScanEvent.createMany({
      data: [
        { restaurantId, sessionId: sessions[0], outcome: 'VIEWED_MENU' },
        { restaurantId, sessionId: sessions[0], outcome: 'VIEWED_MENU' },
        { restaurantId, sessionId: sessions[0], outcome: 'STARTED_ORDER' },
        { restaurantId, sessionId: sessions[1], outcome: 'VIEWED_MENU' },
      ],
    });

    // A platform lead and a restaurant that signed up in the period.
    const lead = await ctx.prisma.user.create({ data: { phone: LEAD_PHONE, fullName: 'Pano Aday' } });
    await ctx.prisma.restaurantCustomer.create({ data: { restaurantId: platformId, userId: lead.id } });
    signupId = (
      await ctx.prisma.restaurant.create({
        data: {
          slug: `kpi-e2e-${Date.now().toString(36)}`,
          name: 'Pano Yeni',
          countryCode: 'TR',
          currency: order.currency,
          timezone: 'Europe/Istanbul',
        },
        select: { id: true },
      })
    ).id;

    const after = await board(adminToken);
    expect(after.orders.total).toBe(before.orders.total + 1);
    expect(after.orders.byChannel[order.channel]).toBe(before.orders.byChannel[order.channel] + 1);
    expect(after.orders.firstOrders).toBe(before.orders.firstOrders + 1);
    const today = new Date().toISOString().slice(0, 10);
    const dayOf = (kpi: PlatformKpiDTO) => kpi.daily.find((d) => d.date === today)?.orders ?? 0;
    expect(dayOf(after)).toBe(dayOf(before) + 1);
    expect(after.daily.reduce((n, d) => n + d.orders, 0)).toBe(after.orders.total);
    const money = (kpi: PlatformKpiDTO) => kpi.money.find((m) => m.currency === order.currency);
    expect((money(after)?.gmvMinor ?? 0) - (money(before)?.gmvMinor ?? 0)).toBe(order.itemsGrossMinor);
    expect((money(after)?.commissionMinor ?? 0) - (money(before)?.commissionMinor ?? 0)).toBe(
      order.platformCommissionMinor,
    );
    expect(after.restaurants.active).toBeGreaterThanOrEqual(1);
    expect(after.restaurants.total).toBe(before.restaurants.total + 1);

    const step = (kpi: PlatformKpiDTO, funnel: 'tableQr' | 'restaurants', key: string) =>
      kpi.funnels[funnel].find((s) => s.key === key)?.count ?? 0;
    expect(step(after, 'tableQr', 'VIEWED_MENU')).toBe(step(before, 'tableQr', 'VIEWED_MENU') + 2);
    expect(step(after, 'tableQr', 'STARTED_ORDER')).toBe(step(before, 'tableQr', 'STARTED_ORDER') + 1);
    expect(step(after, 'restaurants', 'leads')).toBe(step(before, 'restaurants', 'leads') + 1);
    expect(step(after, 'restaurants', 'signups')).toBe(step(before, 'restaurants', 'signups') + 1);
    expect(step(after, 'restaurants', 'listed')).toBe(step(before, 'restaurants', 'listed'));

    // The defining KPI follows its formula; the platform tenant never counts as a restaurant.
    const activeInRange = await ctx.prisma.order.groupBy({
      by: ['restaurantId'],
      where: {
        placedAt: { gte: new Date(after.from), lte: new Date(after.to) },
        status: { not: 'PENDING_PAYMENT' },
        restaurant: { isPlatform: false },
      },
    });
    expect(after.orders.perRestaurantPerDay).toBe(
      ordersPerRestaurantPerDay(after.orders.total, activeInRange.length, after.days),
    );
    expect(after.districts.length).toBeGreaterThan(0);

    // Totals only: no phone or name of the buyer or the lead appears anywhere.
    const text = JSON.stringify(after);
    for (const secret of [BUYER_PHONE, LEAD_PHONE, 'Pano Alici', 'Pano Aday']) expect(text).not.toContain(secret);
  });
});
