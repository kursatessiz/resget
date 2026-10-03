import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Customers, reports and the courier screen (docs/PANEL.md). */
describe('Panel screens: customers, reports, courier (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let guestToken: string;
  let restaurantId: string;
  let trialEndsAt: Date | null = null;
  let subscriptionId: string | null = null;
  let originalProviderId: string | null = null;

  beforeAll(async () => {
    ctx = await createTestApp();
    ownerToken = await ctx.login(SEED.ownerPhone);
    guestToken = await ctx.login(SEED.guestPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, courierProviderId: true, subscription: { select: { id: true, trialEndsAt: true } } },
    });
    restaurantId = restaurant.id;
    originalProviderId = restaurant.courierProviderId;
    subscriptionId = restaurant.subscription?.id ?? null;
    trialEndsAt = restaurant.subscription?.trialEndsAt ?? null;
  });

  afterAll(async () => {
    if (subscriptionId)
      await ctx.prisma.restaurantSubscription.update({ where: { id: subscriptionId }, data: { trialEndsAt } });
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { courierProviderId: originalProviderId },
    });
    await ctx.close();
  });

  it('lists customers with a summary, searches, and shows a customer with recent orders', async () => {
    const list = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/customers?sort=orders`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(list.body.summary.total).toBeGreaterThanOrEqual(1);
    expect(list.body.items.length).toBeGreaterThanOrEqual(1);
    const first = list.body.items[0];
    expect(first.phone).toMatch(/^\+/);
    const search = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/customers?query=${encodeURIComponent(first.fullName.slice(0, 4))}`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(search.body.items.map((c: { id: string }) => c.id)).toContain(first.id);
    const detail = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/customers/${first.id}`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(detail.body.id).toBe(first.id);
    const orders = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/customers/${first.id}/orders`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(Array.isArray(orders.body)).toBe(true);
    for (const order of orders.body as { customer: { userId: string | null } }[]) {
      expect(order.customer.userId).toBe(first.userId);
    }
  });

  it('saves tags and a note on PRO and refuses them once the trial has lapsed', async () => {
    const list = await ctx.http().get(`/restaurants/${restaurantId}/customers`).set(bearer(ownerToken)).expect(200);
    const customer = list.body.items[0];
    const updated = await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/customers/${customer.id}`)
      .set(bearer(ownerToken))
      .send({ tags: ['vip', 'vip', 'ogle'], note: 'Acisiz sever' })
      .expect(200);
    expect(updated.body.tags).toEqual(['vip', 'ogle']);
    expect(updated.body.note).toBe('Acisiz sever');
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/customers/${customer.id}`)
      .set(bearer(ownerToken))
      .send({ tags: [], note: null })
      .expect(200);

    if (!subscriptionId) throw new Error('seed restaurant has no subscription');
    await ctx.prisma.restaurantSubscription.update({
      where: { id: subscriptionId },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    });
    const lapsedToken = await ctx.login(SEED.ownerPhone);
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/customers/${customer.id}`)
      .set(bearer(lapsedToken))
      .send({ note: 'x' })
      .expect(403)
      .expect('x-error-code', 'PLAN_FEATURE_REQUIRED');
    await ctx.http().get(`/restaurants/${restaurantId}/reports/summary?days=90`).set(bearer(lapsedToken)).expect(403);
    await ctx.http().get(`/restaurants/${restaurantId}/reports/orders.csv?days=7`).set(bearer(lapsedToken)).expect(403);
    const basic = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/reports/summary?days=30`)
      .set(bearer(lapsedToken))
      .expect(200);
    expect(basic.body.analytics).toBe(false);
    await ctx.prisma.restaurantSubscription.update({ where: { id: subscriptionId }, data: { trialEndsAt } });
  });

  it('reports the completed orders of the range and exports them as CSV on PRO', async () => {
    const summary = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/reports/summary?days=365`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(summary.body.analytics).toBe(true);
    expect(summary.body.daily).toHaveLength(365);
    expect(summary.body.completedOrders).toBe(
      summary.body.daily.reduce((n: number, d: { orders: number }) => n + d.orders, 0),
    );
    expect(summary.body.grossMinor).toBe(
      summary.body.byFulfillment.reduce((n: number, b: { grossMinor: number }) => n + b.grossMinor, 0),
    );
    if (summary.body.completedOrders > 0) {
      expect(summary.body.averageBasketMinor).toBe(Math.round(summary.body.grossMinor / summary.body.completedOrders));
      expect(summary.body.topItems.length).toBeGreaterThan(0);
    }
    const csv = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/reports/orders.csv?days=365`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = (csv.text as string).trim().split('\r\n');
    expect(lines[0]).toBe(
      'order,placedAt,completedAt,fulfillment,channel,paymentMethod,customer,chargedMinor,commissionMinor,commissionVatMinor,currency',
    );
    expect(lines.length - 1).toBe(summary.body.completedOrders);
    await ctx.http().get(`/restaurants/${restaurantId}/reports/summary?days=0`).set(bearer(ownerToken)).expect(400);
  });

  it('shows the courier screen and selects a network of the restaurant country only', async () => {
    const overview = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/courier/overview`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(overview.body.couriers.length).toBeGreaterThanOrEqual(1);
    expect(overview.body.providers.length).toBeGreaterThanOrEqual(1);
    expect(typeof overview.body.today.trips).toBe('number');
    const provider = overview.body.providers.find((p: { isActive: boolean }) => p.isActive);
    const selected = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/courier/provider`)
      .set(bearer(ownerToken))
      .send({ courierProviderId: provider.id })
      .expect(200);
    expect(selected.body.selectedProviderId).toBe(provider.id);
    const foreign = await ctx.prisma.courierProvider.create({
      data: { code: `e2e-foreign-${Date.now().toString(36)}`, name: 'Foreign Net', countryCode: 'ZZ' },
    });
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/courier/provider`)
      .set(bearer(ownerToken))
      .send({ courierProviderId: foreign.id })
      .expect(404)
      .expect('x-error-code', 'COURIER_PROVIDER_NOT_FOUND');
    await ctx.prisma.courierProvider.delete({ where: { id: foreign.id } });
    const cleared = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/courier/provider`)
      .set(bearer(ownerToken))
      .send({ courierProviderId: null })
      .expect(200);
    expect(cleared.body.selectedProviderId).toBeNull();
  });

  it('keeps the screens closed to a user without membership', async () => {
    await ctx.http().get(`/restaurants/${restaurantId}/customers`).set(bearer(guestToken)).expect(403);
    await ctx.http().get(`/restaurants/${restaurantId}/reports/summary`).set(bearer(guestToken)).expect(403);
    await ctx.http().get(`/restaurants/${restaurantId}/courier/overview`).set(bearer(guestToken)).expect(403);
  });
});
