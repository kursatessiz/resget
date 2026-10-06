import { API_KEY_HEADER, parseApiKeyToken } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { ApiKeyExpiryNotifier } from '../../src/modules/api-keys/api-key-expiry.notifier';

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
    const secret = parseApiKeyToken(token)!.secret;
    expect(secret).toHaveLength(43);
    expect(JSON.stringify(mine)).not.toContain(secret);
    // Only a hash is stored.
    const row = await ctx.prisma.restaurantApiKey.findUniqueOrThrow({ where: { id: keyId } });
    expect(row.secretHash).not.toContain(secret);

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

  it('counts requests per key and UTC day and reports them to the panel', async () => {
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/api-keys`)
      .set(bearer(ownerToken, restaurantId))
      .send({ name: 'E2E Counted', permissions: ['orders.view'], expiresInDays: 30 })
      .expect(201);
    const id = created.body.id as string;
    const expiresAt = new Date(created.body.expiresAt as string).getTime();
    expect(Math.abs(expiresAt - (Date.now() + 30 * 86_400_000))).toBeLessThan(60_000);
    expect(created.body.requestsLastDays).toBe(0);
    for (let i = 0; i < 3; i++) {
      await ctx
        .http()
        .get(`/restaurants/${restaurantId}/orders`)
        .set(API_KEY_HEADER, created.body.token as string)
        .expect(200);
    }

    const list = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/api-keys`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(list.body.find((k: { id: string }) => k.id === id).requestsLastDays).toBe(3);
    const usage = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/api-keys/${id}/usage`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(usage.body.days).toHaveLength(30);
    expect(usage.body.days[29]).toEqual({ day: new Date().toISOString().slice(0, 10), requests: 3 });
    expect(usage.body.total).toBe(3);
    // A key reads no usage, and another restaurant's or an unknown key is not found.
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/api-keys/${id}/usage`)
      .set(API_KEY_HEADER, created.body.token as string)
      .expect(403);
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/api-keys/00000000-0000-4000-8000-000000000000/usage`)
      .set(bearer(ownerToken, restaurantId))
      .expect(404)
      .expect('x-error-code', 'API_KEY_NOT_FOUND');
  });

  it('refuses a key past its date with its own code and offers only the listed lifetimes', async () => {
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/api-keys`)
      .set(bearer(ownerToken, restaurantId))
      .send({ name: 'E2E Odd life', permissions: ['orders.view'], expiresInDays: 7 })
      .expect(400);
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/api-keys`)
      .set(bearer(ownerToken, restaurantId))
      .send({ name: 'E2E Expiring', permissions: ['orders.view'] })
      .expect(201);
    expect(created.body.expiresAt).toBeNull();
    await ctx.prisma.restaurantApiKey.update({
      where: { id: created.body.id as string },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/orders`)
      .set(API_KEY_HEADER, created.body.token as string)
      .expect(401)
      .expect('x-error-code', 'API_KEY_EXPIRED');
    const list = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/api-keys`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    const expired = list.body.find((k: { id: string }) => k.id === created.body.id);
    expect(expired.revokedAt).toBeNull();
    expect(expired.requestsLastDays).toBe(0);
  });

  it('reminds the owner once, a week ahead, of a key about to expire', async () => {
    const notifier = ctx.app.get(ApiKeyExpiryNotifier);
    const mint = async (name: string) =>
      (
        await ctx
          .http()
          .post(`/restaurants/${restaurantId}/api-keys`)
          .set(bearer(ownerToken, restaurantId))
          .send({ name, permissions: ['orders.view'], expiresInDays: 30 })
          .expect(201)
      ).body.id as string;
    const soon = await mint('E2E Soon');
    const later = await mint('E2E Later');
    const revoked = await mint('E2E Revoked soon');
    const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);
    await ctx.prisma.restaurantApiKey.update({ where: { id: soon }, data: { expiresAt: inDays(3) } });
    await ctx.prisma.restaurantApiKey.update({ where: { id: later }, data: { expiresAt: inDays(10) } });
    await ctx.prisma.restaurantApiKey.update({
      where: { id: revoked },
      data: { expiresAt: inDays(2), revokedAt: new Date() },
    });
    const since = new Date();

    expect(await notifier.run()).toBe(1);
    expect(await notifier.run()).toBe(0);
    const logs = await ctx.prisma.messageLog.findMany({
      where: { restaurantId, templateKey: 'apiKey.expiring', createdAt: { gte: since } },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ channel: 'SMS', status: 'SENT', creditsCharged: 0 });
    const rows = await ctx.prisma.restaurantApiKey.findMany({
      where: { id: { in: [soon, later, revoked] } },
      select: { id: true, expiryNoticeAt: true },
    });
    expect(rows.find((r) => r.id === soon)!.expiryNoticeAt).not.toBeNull();
    expect(rows.find((r) => r.id === later)!.expiryNoticeAt).toBeNull();
    expect(rows.find((r) => r.id === revoked)!.expiryNoticeAt).toBeNull();
  });
});
