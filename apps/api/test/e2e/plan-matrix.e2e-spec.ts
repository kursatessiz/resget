import type {
  MeDTO,
  PlanDTO,
  PlanFeaturesChangeDTO,
  RestaurantEntitlementsDTO,
  RestaurantSettingsDTO,
} from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const E2E_PLAN = 'E2E_GROWTH';

/** Plans as data, period-end grace and per-restaurant exceptions (docs/PLAN_MATRISI.md). */
describe('Plan matrix (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let original: {
    planId: string;
    status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
  };
  let startedAt: Date;
  const admin = () => bearer(adminToken);
  const owner = () => bearer(ownerToken);
  const plans = async () => (await ctx.http().get('/admin/plans').set(admin()).expect(200)).body as PlanDTO[];
  const planOf = async (code: string) => (await plans()).find((p) => p.code === code)!;
  const setFeatures = async (code: string, features: string[]) =>
    (
      await ctx
        .http()
        .put(`/admin/plans/${(await planOf(code)).id}/features`)
        .set(admin())
        .send({ features })
        .expect(200)
    ).body as PlanFeaturesChangeDTO;
  const entitlements = async () =>
    (await ctx.http().get(`/admin/restaurants/${restaurantId}/entitlements`).set(admin()).expect(200))
      .body as RestaurantEntitlementsDTO;
  const kitchen = (status: number) =>
    ctx.http().get(`/restaurants/${restaurantId}/kitchen`).set(owner()).expect(status);
  const membership = async () => {
    const me = (await ctx.http().get('/auth/me').set(owner()).expect(200)).body as MeDTO;
    return me.memberships.find((m) => m.restaurantId === restaurantId)!;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    startedAt = new Date();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { subscription: true },
    });
    restaurantId = restaurant.id;
    const { planId, status, trialEndsAt, currentPeriodEnd } = restaurant.subscription!;
    original = { planId, status, trialEndsAt, currentPeriodEnd };
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    await ctx.prisma.plan.deleteMany({ where: { code: E2E_PLAN } });
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/kitchen_display`)
      .set(admin())
      .send({ enabled: true })
      .expect(200);
  });

  afterAll(async () => {
    await ctx.prisma.restaurantSubscription.update({ where: { restaurantId }, data: original });
    await ctx.prisma.restaurantEntitlement.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await ctx.prisma.plan.deleteMany({ where: { code: E2E_PLAN } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'kitchen_display' } });
    const pro = await ctx.prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
    await ctx.prisma.plan.update({ where: { id: pro.id }, data: { excludedFeatures: [] } });
    await ctx.close();
  });

  it('serves the plans with their matrix rows; only the super admin', async () => {
    await ctx.http().get('/admin/plans').set(owner()).expect(403);
    const basic = await planOf('BASIC');
    const pro = await planOf('PRO');
    expect(basic.isFallback).toBe(true);
    expect(basic.features).toEqual(expect.arrayContaining(['orders', 'menu', 'kitchen_display']));
    expect(basic.features).not.toContain('campaigns');
    expect(pro.isFallback).toBe(false);
    expect(pro.features).toEqual(expect.arrayContaining(['campaigns', 'crm', 'kitchen_display']));
  });

  it('keeps a removed module until the period ends, then closes it with PLAN_FEATURE_REQUIRED', async () => {
    await kitchen(200);
    const pro = await planOf('PRO');
    const change = await setFeatures(
      'PRO',
      pro.features.filter((k) => k !== 'kitchen_display'),
    );
    expect(change.removed).toEqual(['kitchen_display']);
    expect(change.graceGranted).toBeGreaterThanOrEqual(1);

    // The restaurant is on a PRO trial: the grace runs to the trial end.
    const view = await entitlements();
    const grace = view.grants.find((g) => g.key === 'kitchen_display' && g.source === 'GRACE')!;
    const subscription = await ctx.prisma.restaurantSubscription.findUniqueOrThrow({ where: { restaurantId } });
    expect(new Date(grace.until!).getTime()).toBe(subscription.trialEndsAt!.getTime());
    expect(view.planFeatures).not.toContain('kitchen_display');
    expect(view.entitlements).toContain('kitchen_display');
    await kitchen(200);

    // The period is over (here: the grace is ended by the console).
    await ctx.http().delete(`/admin/restaurants/${restaurantId}/entitlements/${grace.id}`).set(admin()).expect(200);
    expect((await kitchen(403)).headers['x-error-code']).toBe('PLAN_FEATURE_REQUIRED');
    const m = await membership();
    expect(m.entitlements).not.toContain('kitchen_display');
    expect(m.features).not.toContain('kitchen_display');
  });

  it('opens a key for one restaurant with a "plan dışı açık" exception', async () => {
    const view = (
      await ctx
        .http()
        .post(`/admin/restaurants/${restaurantId}/entitlements`)
        .set(admin())
        .send({ key: 'kitchen_display', note: 'pilot' })
        .expect(201)
    ).body as RestaurantEntitlementsDTO;
    const exception = view.grants.find((g) => g.source === 'EXCEPTION')!;
    expect(exception).toMatchObject({ key: 'kitchen_display', until: null, note: 'pilot' });
    await kitchen(200);
    expect((await membership()).features).toContain('kitchen_display');

    await ctx
      .http()
      .post(`/admin/restaurants/${restaurantId}/entitlements`)
      .set(admin())
      .send({ key: 'kitchen_display', until: new Date(Date.now() - 60_000).toISOString() })
      .expect(400);
    await ctx.http().delete(`/admin/restaurants/${restaurantId}/entitlements/${exception.id}`).set(admin()).expect(200);
    await kitchen(403);
    await ctx.http().delete(`/admin/restaurants/${restaurantId}/entitlements/${exception.id}`).set(admin()).expect(404);
  });

  it('adding the key back opens it again for the plan', async () => {
    const pro = await planOf('PRO');
    const change = await setFeatures('PRO', [...pro.features, 'kitchen_display']);
    expect(change).toMatchObject({ added: ['kitchen_display'], removed: [], graceGranted: 0 });
    await kitchen(200);
  });

  it('a new plan is data: created in the console, it decides what its restaurants get', async () => {
    const basic = await planOf('BASIC');
    const created = (
      await ctx
        .http()
        .post('/admin/plans')
        .set(admin())
        .send({
          code: E2E_PLAN,
          name: 'Growth',
          monthlyPriceMinor: 49900,
          currency: 'TRY',
          trialDays: 0,
          features: [...basic.features, 'crm'],
        })
        .expect(201)
    ).body as PlanDTO;
    expect(created).toMatchObject({ code: E2E_PLAN, isFree: false, isFallback: false });
    expect(created.features).toContain('crm');
    expect(created.features).not.toContain('campaigns');
    await ctx
      .http()
      .post('/admin/plans')
      .set(admin())
      .send({ code: E2E_PLAN, name: 'Again', monthlyPriceMinor: 0, currency: 'TRY' })
      .expect(409)
      .expect('x-error-code', 'PLAN_CODE_TAKEN');

    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/plan`)
      .set(admin())
      .send({ planId: created.id, currentPeriodEnd: new Date(Date.now() - 1000).toISOString() })
      .expect(400);
    const assigned = (
      await ctx
        .http()
        .put(`/admin/restaurants/${restaurantId}/plan`)
        .set(admin())
        .send({ planId: created.id })
        .expect(200)
    ).body as RestaurantEntitlementsDTO;
    expect(assigned).toMatchObject({ planCode: E2E_PLAN, planName: 'Growth' });
    const settings = (await ctx.http().get(`/restaurants/${restaurantId}`).set(owner()).expect(200))
      .body as RestaurantSettingsDTO;
    expect(settings).toMatchObject({ effectivePlan: E2E_PLAN, planName: 'Growth' });
    expect(settings.entitlements).toContain('crm');
    expect(settings.entitlements).not.toContain('campaigns');
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/campaigns`)
      .set(owner())
      .expect(403)
      .expect('x-error-code', 'PLAN_FEATURE_REQUIRED');

    // An exception opens a plan feature too.
    await ctx
      .http()
      .post(`/admin/restaurants/${restaurantId}/entitlements`)
      .set(admin())
      .send({ key: 'campaigns' })
      .expect(201);
    await ctx.http().get(`/restaurants/${restaurantId}/campaigns`).set(owner()).expect(200);
  });

  it('the free fallback plan stays free and on sale', async () => {
    const basic = await planOf('BASIC');
    await ctx
      .http()
      .patch(`/admin/plans/${basic.id}`)
      .set(admin())
      .send({ isActive: false })
      .expect(409)
      .expect('x-error-code', 'PLAN_FALLBACK_LOCKED');
    await ctx
      .http()
      .patch(`/admin/plans/${basic.id}`)
      .set(admin())
      .send({ monthlyPriceMinor: 100 })
      .expect(409)
      .expect('x-error-code', 'PLAN_FALLBACK_LOCKED');
  });
});
