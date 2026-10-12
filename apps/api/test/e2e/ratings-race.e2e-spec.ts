import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/**
 * The restaurant's running rating sum stays equal to the sum of its visible scores when the customer's edits race
 * each other or the platform owner's hide and restore decisions (docs/YORUMLAR.md).
 */
describe('Rating aggregate under concurrency (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let menuItemId: string;
  const orderIds: string[] = [];
  let ratingSumBefore = 0;
  let ratingCountBefore = 0;
  const owner = () => bearer(ownerToken, restaurantId);

  const ratedOrder = async (score: number) => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity: 1 }],
        customer: {
          fullName: 'Yaris Puan',
          phone: `05328${String(Date.now()).slice(-4)}${String(orderIds.length).padStart(2, '0')}`,
        },
      })
      .expect(201);
    const id = res.body.id as string;
    orderIds.push(id);
    for (const step of [{ to: 'ACCEPTED', prepMinutes: 5 }, { to: 'READY' }, { to: 'PICKED_UP' }]) {
      await ctx.http().post(`/restaurants/${restaurantId}/orders/${id}/transition`).set(owner()).send(step).expect(200);
    }
    const token = (res.body.trackingUrl as string).split('/t/')[1];
    await ctx.http().post(`/public/orders/${token}/rating`).send({ score }).expect(201);
    const rating = await ctx.prisma.orderRating.findUniqueOrThrow({ where: { orderId: id } });
    return { id, token, ratingId: rating.id };
  };

  // Each request comes from its own client address so the per-client limit never answers instead of the service.
  let client = 0;
  const edit = (token: string, score: number) =>
    ctx
      .http()
      .patch(`/public/orders/${token}/rating`)
      .set('x-forwarded-for', `198.51.100.${(client++ % 250) + 1}`)
      .send({ score });

  const snapshot = () =>
    ctx.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { ratingSum: true, ratingCount: true },
    });

  /** Since the snapshot, the restaurant's sum and count moved by exactly the rating's visible score. */
  const expectConsistent = async (base: { ratingSum: number; ratingCount: number }, ratingId: string) => {
    const [restaurant, row] = await Promise.all([
      snapshot(),
      ctx.prisma.orderRating.findUniqueOrThrow({ where: { id: ratingId } }),
    ]);
    const visible = row.hiddenAt === null;
    expect({
      sum: restaurant.ratingSum - base.ratingSum,
      count: restaurant.ratingCount - base.ratingCount,
    }).toEqual({ sum: visible ? row.score : 0, count: visible ? 1 : 0 });
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
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
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/public_reviews`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
  });

  afterAll(async () => {
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { ratingSum: ratingSumBefore, ratingCount: ratingCountBefore },
    });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'public_reviews' } });
    await ctx.close();
  });

  it('applies the score change once when the same edit arrives in parallel', async () => {
    const base = await snapshot();
    const order = await ratedOrder(1);
    const results = await Promise.all(Array.from({ length: 16 }, () => edit(order.token, 5)));
    expect(results.map((r) => r.status).every((s) => s === 200)).toBe(true);
    const row = await ctx.prisma.orderRating.findUniqueOrThrow({ where: { id: order.ratingId } });
    expect(row.score).toBe(5);
    await expectConsistent(base, order.ratingId);
  });

  it('keeps the sum equal to the final score when opposite edits race', async () => {
    const base = await snapshot();
    const order = await ratedOrder(5);
    const results = await Promise.all(Array.from({ length: 16 }, (_, i) => edit(order.token, i % 2 === 0 ? 1 : 5)));
    expect(results.map((r) => r.status).every((s) => s === 200)).toBe(true);
    await expectConsistent(base, order.ratingId);
  });

  it('keeps the sum consistent when edits race a hide and a restore', async () => {
    const base = await snapshot();
    const order = await ratedOrder(2);
    const decide = (action: 'HIDE' | 'RESTORE') =>
      ctx
        .http()
        .post(`/admin/reviews/${order.ratingId}/decision`)
        .set(bearer(adminToken))
        .send({ action, note: 'Yaris' });
    await Promise.all([...Array.from({ length: 8 }, (_, i) => edit(order.token, i % 2 === 0 ? 5 : 1)), decide('HIDE')]);
    await expectConsistent(base, order.ratingId);
    await Promise.all([
      ...Array.from({ length: 8 }, (_, i) => edit(order.token, i % 2 === 0 ? 4 : 3)),
      decide('RESTORE'),
    ]);
    await expectConsistent(base, order.ratingId);
  });
});
