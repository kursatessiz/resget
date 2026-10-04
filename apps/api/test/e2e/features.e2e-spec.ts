import { API_KEY_HEADER } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Module switches (docs/OZELLIK_ANAHTARLARI.md): console, guard, public routes, API keys and the member's menu. */
describe('Feature switches (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let apiKey: string;

  const setGlobal = (key: string, enabled: boolean | null, expected = 200, token = adminToken) =>
    ctx.http().put(`/admin/features/${key}`).set(bearer(token)).send({ enabled }).expect(expected);
  const setOwn = (key: string, enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/${key}`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const myFeatures = async () => {
    const me = await ctx.http().get('/auth/me').set(bearer(ownerToken)).expect(200);
    return (me.body.memberships as { restaurantId: string; features: string[] }[]).find(
      (m) => m.restaurantId === restaurantId,
    )!.features;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    restaurantId = (
      await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug }, select: { id: true } })
    ).id;
    await ctx.prisma.featureFlag.deleteMany({});
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/api-keys`)
      .set(bearer(ownerToken, restaurantId))
      .send({ name: 'E2E features', permissions: ['orders.view'] })
      .expect(201);
    apiKey = created.body.token as string;
  });

  afterAll(async () => {
    await ctx.prisma.featureFlag.deleteMany({});
    await ctx.prisma.restaurantApiKey.deleteMany({ where: { restaurantId, name: 'E2E features' } });
    await ctx.prisma.auditLog.deleteMany({ where: { action: { startsWith: 'feature.' } } });
    await ctx.close();
  });

  it('is for the platform owner only and lists every module with its default', async () => {
    await ctx.http().get('/admin/features').set(bearer(ownerToken)).expect(403);
    await setGlobal('loyalty', false, 403, ownerToken);
    const list = await ctx.http().get('/admin/features').set(bearer(adminToken)).expect(200);
    const loyalty = (list.body as { key: string; global: boolean | null; enabled: boolean }[]).find(
      (f) => f.key === 'loyalty',
    );
    expect(loyalty).toMatchObject({ global: null, enabled: true });
    await setGlobal('no_such_module', true, 400);
  });

  it('switches a module off everywhere, and back on for one restaurant', async () => {
    await ctx.http().get(`/restaurants/${restaurantId}/loyalty`).set(bearer(ownerToken, restaurantId)).expect(200);
    const off = await setGlobal('loyalty', false);
    expect((off.body as { key: string; enabled: boolean }[]).find((f) => f.key === 'loyalty')?.enabled).toBe(false);
    const refused = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/loyalty`)
      .set(bearer(ownerToken, restaurantId))
      .expect(403);
    expect(refused.body.code).toBe('FEATURE_DISABLED');
    expect(await myFeatures()).not.toContain('loyalty');

    // The restaurant's own switch wins over the global one.
    const own = await setOwn('loyalty', true);
    expect((own.body as { key: string; override: boolean | null }[]).find((f) => f.key === 'loyalty')).toMatchObject({
      override: true,
      enabled: true,
    });
    await ctx.http().get(`/restaurants/${restaurantId}/loyalty`).set(bearer(ownerToken, restaurantId)).expect(200);
    expect(await myFeatures()).toContain('loyalty');
    const listed = await ctx.http().get('/admin/features').set(bearer(adminToken)).expect(200);
    expect(
      (listed.body as { key: string; overrides: { restaurantId: string }[] }[])
        .find((f) => f.key === 'loyalty')!
        .overrides.map((o) => o.restaurantId),
    ).toEqual([restaurantId]);

    await setOwn('loyalty', null);
    await setGlobal('loyalty', null);
    await ctx.http().get(`/restaurants/${restaurantId}/loyalty`).set(bearer(ownerToken, restaurantId)).expect(200);
    expect(await ctx.prisma.auditLog.count({ where: { action: { startsWith: 'feature.' } } })).toBeGreaterThanOrEqual(
      4,
    );
  });

  it('closes public surfaces and API keys of a switched-off module', async () => {
    await setOwn('table_qr', false);
    const qr = await ctx.http().get(`/public/qr/${SEED.tableToken}`).expect(403);
    expect(qr.body.code).toBe('FEATURE_DISABLED');
    await setOwn('table_qr', null);
    await ctx.http().get(`/public/qr/${SEED.tableToken}`).expect(200);

    await ctx.http().get(`/restaurants/${restaurantId}/orders`).set(API_KEY_HEADER, apiKey).expect(200);
    await setOwn('api_access', false);
    const key = await ctx.http().get(`/restaurants/${restaurantId}/orders`).set(API_KEY_HEADER, apiKey).expect(403);
    expect(key.body.code).toBe('FEATURE_DISABLED');
    // The panel itself keeps working with a session.
    await ctx.http().get(`/restaurants/${restaurantId}/orders`).set(bearer(ownerToken, restaurantId)).expect(200);
    await setOwn('api_access', null);
  });

  it('stops offering a switched-off payment method', async () => {
    await setOwn('meal_cards', false);
    const methods = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/payment-methods`).expect(200);
    expect(methods.body).toMatchObject({ mealCardsOnline: [], mealCardsOnDelivery: [] });
    await setOwn('meal_cards', null);
  });
});
