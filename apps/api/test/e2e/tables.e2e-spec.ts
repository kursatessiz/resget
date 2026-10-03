import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

describe('Tables and QR funnel (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let branchId: string;
  let ownerToken: string;
  let createdTableId: string | null = null;
  const session = `e2e-funnel-${Date.now()}`;

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    ownerToken = await ctx.login(SEED.ownerPhone);
  });
  afterAll(async () => {
    if (createdTableId) await ctx.prisma.diningTable.deleteMany({ where: { id: createdTableId } });
    await ctx.prisma.qrScanEvent.deleteMany({ where: { sessionId: session } });
    await ctx.close();
  });

  it('lists the seeded tables with their public QR URLs', async () => {
    const res = await ctx.http().get(`/restaurants/${restaurantId}/tables`).set(bearer(ownerToken)).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(4);
    const first = res.body.find((t: { label: string }) => t.label === '1');
    expect(first.qrUrl).toMatch(new RegExp(`/m/${SEED.tableToken}$`));
  });

  it('creates a table and regenerates its token', async () => {
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/tables`)
      .set(bearer(ownerToken))
      .send({ branchId, label: 'E2E' })
      .expect(201);
    createdTableId = created.body.id as string;
    const before = created.body.qrUrl as string;
    const regenerated = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/tables/${createdTableId}/regenerate`)
      .set(bearer(ownerToken))
      .expect(201);
    expect(regenerated.body.qrUrl).not.toBe(before);
    // The old token stops working.
    const oldToken = before.split('/m/')[1];
    await ctx.http().get(`/public/qr/${oldToken}`).expect(404);
  });

  it('computes the funnel from recorded scan events', async () => {
    await ctx.http().get(`/public/qr/${SEED.tableToken}`).set('x-qr-session', session).expect(200);
    await ctx.prisma.qrScanEvent.create({ data: { restaurantId, sessionId: session, outcome: 'PLACED_ORDER' } });
    const res = await ctx.http().get(`/restaurants/${restaurantId}/tables/funnel`).set(bearer(ownerToken)).expect(200);
    expect(res.body.viewedMenu).toBeGreaterThanOrEqual(1);
    expect(res.body.placedOrder).toBeGreaterThanOrEqual(1);
    expect(res.body.viewToOrderRate).toBeGreaterThan(0);
  });
});
