import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const NOTE = 'e2e-transition-race';

/** Two staff screens acting on the same order at once: one change wins, the other is told it is stale. */
describe('Concurrent order transitions (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let itemId: string;

  const transition = (orderId: string, body: Record<string, unknown>) =>
    ctx.http().post(`/restaurants/${restaurantId}/orders/${orderId}/transition`).set(bearer(ownerToken)).send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true, menuItems: true },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    itemId = restaurant.menuItems.find((m) => m.name === 'Izgara kofte')!.id;
    ownerToken = await ctx.login(SEED.ownerPhone);
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
  });

  afterAll(async () => {
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.close();
  });

  it('applies a status change once when two requests race', async () => {
    const order = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken))
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 1 }],
        note: NOTE,
      })
      .expect(201);
    const orderId = order.body.id as string;
    const results = await Promise.all([
      transition(orderId, { to: 'ACCEPTED', prepMinutes: 10 }),
      transition(orderId, { to: 'ACCEPTED', prepMinutes: 20 }),
      transition(orderId, { to: 'ACCEPTED', prepMinutes: 30 }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const loser of results.filter((r) => r.status !== 200)) {
      expect(loser.status).toBe(409);
      expect(loser.headers['x-error-code']).toBe('ORDER_TRANSITION_INVALID');
    }
    const accepted = await ctx.prisma.orderStatusHistory.findMany({ where: { orderId, toStatus: 'ACCEPTED' } });
    expect(accepted).toHaveLength(1);
  });
});
