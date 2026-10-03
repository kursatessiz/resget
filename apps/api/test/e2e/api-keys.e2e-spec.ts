import { API_KEY_HEADER } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Restaurant API keys (docs/API_ERISIMI.md): mint, call with the key, scope, session-only routes, revoke, plan gate. */
describe('API keys (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let restaurantId: string;
  let subscriptionId: string | null = null;
  let trialEndsAt: Date | null = null;
  let token: string;
  let keyId: string;

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
    await ctx.prisma.restaurantApiKey.deleteMany({ where: { restaurantId, name: { startsWith: 'E2E ' } } });
    if (subscriptionId)
      await ctx.prisma.restaurantSubscription.update({ where: { id: subscriptionId }, data: { trialEndsAt } });
    await ctx.close();
  });

  it('mints a key once in clear, and the key reads what it was granted and nothing else', async () => {
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/api-keys`)
      .set(bearer(ownerToken, restaurantId))
      .send({ name: 'E2E POS', permissions: ['orders.view', 'menu.view'] })
      .expect(201);
    token = created.body.token as string;
    keyId = created.body.id as string;
    expect(token.startsWith('rsk_')).toBe(true);
    expect(created.body.permissions).toEqual(['orders.view', 'menu.view']);
    // The list never shows the secret again.
    const list = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/api-keys`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    const mine = list.body.find((k: { id: string }) => k.id === keyId);
    expect(mine).toBeDefined();
    expect(mine.token).toBeUndefined();
    expect(JSON.stringify(mine)).not.toContain(token.split('_')[2]);
    // Only a hash is stored.
    const row = await ctx.prisma.restaurantApiKey.findUniqueOrThrow({ where: { id: keyId } });
    expect(row.secretHash).not.toContain(token.split('_')[2]);

    // Granted: orders and menu.
    await ctx.http().get(`/restaurants/${restaurantId}/orders`).set(API_KEY_HEADER, token).expect(200);
    await ctx.http().get(`/restaurants/${restaurantId}/menu`).set(API_KEY_HEADER, token).expect(200);
    // Not granted: customers. Never grantable: settings. Session only: keys themselves.
    await ctx.http().get(`/restaurants/${restaurantId}/customers`).set(API_KEY_HEADER, token).expect(403);
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}`)
      .set(API_KEY_HEADER, token)
      .send({ name: 'Hack' })
      .expect(403);
    await ctx.http().get(`/restaurants/${restaurantId}/api-keys`).set(API_KEY_HEADER, token).expect(403);
    // A key is bound to its restaurant: another id is refused.
    await ctx
      .http()
      .get('/restaurants/00000000-0000-4000-8000-000000000000/orders')
      .set(API_KEY_HEADER, token)
      .expect(403);
    // Bad or malformed keys never fall back to anything.
    await ctx.http().get(`/restaurants/${restaurantId}/orders`).set(API_KEY_HEADER, `${token}x`).expect(401);
    await ctx.http().get(`/restaurants/${restaurantId}/orders`).set(API_KEY_HEADER, 'nonsense').expect(401);
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/orders`)
      .set({ ...bearer(ownerToken, restaurantId), [API_KEY_HEADER]: 'nonsense' })
      .expect(401);
    // Session routes outside the restaurant scope ignore keys entirely.
    await ctx.http().get('/me/account').set(API_KEY_HEADER, token).expect(401);
  });

  it('refuses grants beyond the creator, closes with the plan, and dies on revoke', async () => {
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/api-keys`)
      .set(bearer(ownerToken, restaurantId))
      .send({ name: 'E2E Too much', permissions: ['staff.manage'] })
      .expect(400);

    if (subscriptionId) {
      await ctx.prisma.restaurantSubscription.update({
        where: { id: subscriptionId },
        data: { trialEndsAt: new Date(Date.now() - 1000) },
      });
      await ctx
        .http()
        .get(`/restaurants/${restaurantId}/orders`)
        .set(API_KEY_HEADER, token)
        .expect(403)
        .expect('x-error-code', 'PLAN_FEATURE_REQUIRED');
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/api-keys`)
        .set(bearer(ownerToken, restaurantId))
        .send({ name: 'E2E Basic', permissions: ['orders.view'] })
        .expect(403)
        .expect('x-error-code', 'PLAN_FEATURE_REQUIRED');
      await ctx.prisma.restaurantSubscription.update({ where: { id: subscriptionId }, data: { trialEndsAt } });
      await ctx.http().get(`/restaurants/${restaurantId}/orders`).set(API_KEY_HEADER, token).expect(200);
    }

    const revoked = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/api-keys/${keyId}/revoke`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(revoked.body.revokedAt).not.toBeNull();
    await ctx.http().get(`/restaurants/${restaurantId}/orders`).set(API_KEY_HEADER, token).expect(401);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/api-keys/00000000-0000-4000-8000-000000000000/revoke`)
      .set(bearer(ownerToken, restaurantId))
      .expect(404)
      .expect('x-error-code', 'API_KEY_NOT_FOUND');
  });
});
