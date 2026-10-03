import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Order ratings (docs/VITRIN.md): only a completed order, once, within the window; reports and marketplace read them. */
describe('Order ratings (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let menuItemId: string;
  const orderIds: string[] = [];
  let ratingSumBefore = 0;
  let ratingCountBefore = 0;

  const staffOrder = async () => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken, restaurantId))
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity: 1 }],
        customer: { fullName: 'Puan Veren', phone: '05329990941' },
      })
      .expect(201);
    orderIds.push(res.body.id as string);
    return { id: res.body.id as string, token: (res.body.trackingUrl as string).split('/t/')[1] };
  };
  const transition = (id: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${id}/transition`)
      .set(bearer(ownerToken, restaurantId))
      .send({ to, ...extra })
      .expect(200);

  beforeAll(async () => {
    ctx = await createTestApp();
    ownerToken = await ctx.login(SEED.ownerPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, ratingSum: true, ratingCount: true, branches: { take: 1, select: { id: true } } },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    ratingSumBefore = restaurant.ratingSum;
    ratingCountBefore = restaurant.ratingCount;
    menuItemId = (
      await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, isAvailable: true }, select: { id: true } })
    ).id;
  });

  afterAll(async () => {
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { ratingSum: ratingSumBefore, ratingCount: ratingCountBefore },
    });
    await ctx.close();
  });

  it('refuses before completion, takes one rating after it, and shows it in reports and the marketplace', async () => {
    const order = await staffOrder();
    const before = await ctx.http().get(`/public/orders/${order.token}`).expect(200);
    expect(before.body.canRate).toBe(false);
    expect(before.body.rating).toBeNull();
    await ctx
      .http()
      .post(`/public/orders/${order.token}/rating`)
      .send({ score: 5 })
      .expect(409)
      .expect('x-error-code', 'RATING_NOT_ALLOWED');

    await transition(order.id, 'ACCEPTED', { prepMinutes: 5 });
    await transition(order.id, 'READY');
    await transition(order.id, 'PICKED_UP');
    const ready = await ctx.http().get(`/public/orders/${order.token}`).expect(200);
    expect(ready.body.canRate).toBe(true);

    await ctx.http().post(`/public/orders/${order.token}/rating`).send({ score: 6 }).expect(400);
    const rated = await ctx
      .http()
      .post(`/public/orders/${order.token}/rating`)
      .send({ score: 4, comment: 'Kofte cok iyiydi' })
      .expect(201);
    expect(rated.body.rating).toMatchObject({ score: 4, comment: 'Kofte cok iyiydi' });
    expect(rated.body.canRate).toBe(false);
    await ctx
      .http()
      .post(`/public/orders/${order.token}/rating`)
      .send({ score: 1 })
      .expect(409)
      .expect('x-error-code', 'RATING_EXISTS');

    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { ratingSum: true, ratingCount: true },
    });
    expect(restaurant.ratingCount).toBe(ratingCountBefore + 1);
    expect(restaurant.ratingSum).toBe(ratingSumBefore + 4);

    const report = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/reports/summary?days=7`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(report.body.ratings.count).toBeGreaterThanOrEqual(1);
    expect(report.body.ratings.recent[0]).toMatchObject({ score: 4, comment: 'Kofte cok iyiydi' });

    const market = await ctx
      .http()
      .get('/public/marketplace?countryCode=TR&city=Istanbul&district=Kadikoy')
      .expect(200);
    const demo = market.body.restaurants.find((r: { slug: string }) => r.slug === SEED.restaurantSlug);
    expect(demo.rating.count).toBe(ratingCountBefore + 1);
    expect(demo.rating.average).toBeGreaterThanOrEqual(1);
    expect(demo.rating.average).toBeLessThanOrEqual(5);
  });

  it('closes the window after a week', async () => {
    const order = await staffOrder();
    await transition(order.id, 'ACCEPTED', { prepMinutes: 5 });
    await transition(order.id, 'READY');
    await transition(order.id, 'PICKED_UP');
    await ctx.prisma.order.update({
      where: { id: order.id },
      data: { completedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    });
    const late = await ctx.http().get(`/public/orders/${order.token}`).expect(200);
    expect(late.body.canRate).toBe(false);
    await ctx
      .http()
      .post(`/public/orders/${order.token}/rating`)
      .send({ score: 3 })
      .expect(409)
      .expect('x-error-code', 'RATING_NOT_ALLOWED');
  });
});
