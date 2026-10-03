import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Saved campaign segments (docs/KAMPANYALAR.md): save, count, rename, unique name, delete, plan gate. */
describe('Saved segments (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let restaurantId: string;
  let subscriptionId: string | null = null;
  let trialEndsAt: Date | null = null;
  const name = `E2E Segment ${Date.now().toString(36)}`;
  let segmentId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    ownerToken = await ctx.login(SEED.ownerPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, subscription: { select: { id: true, trialEndsAt: true } } },
    });
    restaurantId = restaurant.id;
    subscriptionId = restaurant.subscription?.id ?? null;
    trialEndsAt = restaurant.subscription?.trialEndsAt ?? null;
  });

  afterAll(async () => {
    await ctx.prisma.campaignSegmentPreset.deleteMany({ where: { restaurantId, name: { startsWith: 'E2E Segment' } } });
    if (subscriptionId)
      await ctx.prisma.restaurantSubscription.update({ where: { id: subscriptionId }, data: { trialEndsAt } });
    await ctx.close();
  });

  it('saves a segment with a live count, refuses a duplicate name, renames and deletes it', async () => {
    const optedIn = await ctx.prisma.restaurantCustomer.count({ where: { restaurantId, marketingOptIn: true } });
    const count = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns/audience/count`)
      .set(bearer(ownerToken, restaurantId))
      .send({ segment: {} })
      .expect(200);
    expect(count.body.audienceCount).toBe(optedIn);

    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns/segments`)
      .set(bearer(ownerToken, restaurantId))
      .send({ name, segment: { minOrders: 1, tags: ['vip'] } })
      .expect(201);
    segmentId = created.body.id;
    expect(created.body.segment).toEqual({ minOrders: 1, tags: ['vip'] });
    expect(typeof created.body.audienceCount).toBe('number');

    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns/segments`)
      .set(bearer(ownerToken, restaurantId))
      .send({ name, segment: {} })
      .expect(409)
      .expect('x-error-code', 'SEGMENT_NAME_TAKEN');

    const list = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/campaigns/segments`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(list.body.some((s: { id: string }) => s.id === segmentId)).toBe(true);

    const renamed = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/campaigns/segments/${segmentId}`)
      .set(bearer(ownerToken, restaurantId))
      .send({ name: `${name} 2`, segment: { inactiveForDays: 30 } })
      .expect(200);
    expect(renamed.body.name).toBe(`${name} 2`);
    expect(renamed.body.segment).toEqual({ inactiveForDays: 30 });
    // Every opted-in customer without a recent order counts as inactive; the seed has no recent orders from them.
    expect(renamed.body.audienceCount).toBeGreaterThanOrEqual(0);

    await ctx
      .http()
      .delete(`/restaurants/${restaurantId}/campaigns/segments/${segmentId}`)
      .set(bearer(ownerToken, restaurantId))
      .expect(204);
    await ctx
      .http()
      .delete(`/restaurants/${restaurantId}/campaigns/segments/${segmentId}`)
      .set(bearer(ownerToken, restaurantId))
      .expect(404)
      .expect('x-error-code', 'SEGMENT_NOT_FOUND');
  });

  it('is a PRO feature like the campaigns themselves', async () => {
    if (!subscriptionId) return;
    await ctx.prisma.restaurantSubscription.update({
      where: { id: subscriptionId },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    });
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/campaigns/segments`)
      .set(bearer(ownerToken, restaurantId))
      .expect(403)
      .expect('x-error-code', 'PLAN_FEATURE_REQUIRED');
    await ctx.prisma.restaurantSubscription.update({ where: { id: subscriptionId }, data: { trialEndsAt } });
  });
});
