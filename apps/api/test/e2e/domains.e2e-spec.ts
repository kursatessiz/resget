import { SEED, bearer, createTestApp } from './support/app';
import { DOMAIN_VERIFIER, MockDomainVerifier } from '../../src/modules/domains/domain-verifier';
import type { TestContext } from './support/app';

/** Custom domains (docs/VITRIN.md): save, refuse the platform host, verify through the MOCK resolver, resolve, clear, plan gate. */
describe('Custom domains (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let restaurantId: string;
  let subscriptionId: string | null = null;
  let trialEndsAt: Date | null = null;
  let otherRestaurantId: string;
  const domain = 'siparis.verified.test';

  beforeAll(async () => {
    ctx = await createTestApp();
    ownerToken = await ctx.login(SEED.ownerPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: {
        id: true,
        countryCode: true,
        currency: true,
        timezone: true,
        subscription: { select: { id: true, trialEndsAt: true } },
      },
    });
    restaurantId = restaurant.id;
    subscriptionId = restaurant.subscription?.id ?? null;
    trialEndsAt = restaurant.subscription?.trialEndsAt ?? null;
    await ctx.prisma.restaurant.deleteMany({ where: { slug: 'e2e-domain-other' } });
    otherRestaurantId = (
      await ctx.prisma.restaurant.create({
        data: {
          slug: 'e2e-domain-other',
          name: 'Other',
          countryCode: restaurant.countryCode,
          currency: restaurant.currency,
          timezone: restaurant.timezone,
          customDomain: 'baska.verified.test',
        },
        select: { id: true },
      })
    ).id;
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { customDomain: null, customDomainVerifiedAt: null },
    });
  });

  afterAll(async () => {
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { customDomain: null, customDomainVerifiedAt: null },
    });
    await ctx.prisma.restaurant.deleteMany({ where: { id: otherRestaurantId } });
    if (subscriptionId)
      await ctx.prisma.restaurantSubscription.update({ where: { id: subscriptionId }, data: { trialEndsAt } });
    await ctx.close();
  });

  it('saves a domain, refuses the platform host and a taken name, verifies it and serves the slug', async () => {
    const empty = await ctx.http().get(`/restaurants/${restaurantId}/domain`).set(bearer(ownerToken, restaurantId));
    expect(empty.status).toBe(200);
    expect(empty.body.domain).toBeNull();
    expect(empty.body.target).toBe('localhost');

    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/domain`)
      .set(bearer(ownerToken, restaurantId))
      .send({ domain: 'menu.localhost' })
      .expect(400);
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/domain`)
      .set(bearer(ownerToken, restaurantId))
      .send({ domain: 'https://x.com/path' })
      .expect(400);
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/domain`)
      .set(bearer(ownerToken, restaurantId))
      .send({ domain: 'baska.verified.test' })
      .expect(409)
      .expect('x-error-code', 'DOMAIN_TAKEN');

    const saved = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/domain`)
      .set(bearer(ownerToken, restaurantId))
      .send({ domain: domain.toUpperCase() })
      .expect(200);
    expect(saved.body.domain).toBe(domain);
    expect(saved.body.verifiedAt).toBeNull();
    expect(saved.body.active).toBe(false);
    // Unverified: nothing is served and no certificate may be issued.
    await ctx.http().get(`/public/domains/resolve?host=${domain}`).expect(404);
    await ctx.http().get(`/public/domains/check?domain=${domain}`).expect(404);

    const verified = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/domain/verify`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(verified.body.verifiedAt).not.toBeNull();
    expect(verified.body.active).toBe(true);
    expect(verified.body.lastCheck).toEqual({ ok: true, seen: ['localhost'], ownershipProven: true });
    const resolved = await ctx.http().get(`/public/domains/resolve?host=${domain}:443`).expect(200);
    expect(resolved.body.slug).toBe(SEED.restaurantSlug);
    await ctx.http().get(`/public/domains/check?domain=${domain}`).expect(200);
    await ctx.http().get('/public/domains/check?domain=unknown.example.com').expect(404);

    // The settings screen reads the same fields.
    const settings = await ctx
      .http()
      .get(`/restaurants/${restaurantId}`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(settings.body.customDomain).toBe(domain);
    expect(settings.body.customDomainVerifiedAt).not.toBeNull();

    // A host that does not point here never verifies.
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/domain`)
      .set(bearer(ownerToken, restaurantId))
      .send({ domain: 'elsewhere.example.com' })
      .expect(200);
    const failed = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/domain/verify`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(failed.body.verifiedAt).toBeNull();
    expect(failed.body.lastCheck).toEqual({ ok: false, seen: [], ownershipProven: false });
    await ctx.http().get(`/public/domains/resolve?host=${domain}`).expect(404);
  });

  it('needs the restaurant TXT proof besides the host pointing at the platform', async () => {
    const host = 'notxt.sahip.verified.test';
    const verifier = ctx.app.get<MockDomainVerifier>(DOMAIN_VERIFIER);
    const saved = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/domain`)
      .set(bearer(ownerToken, restaurantId))
      .send({ domain: host })
      .expect(200);
    const challenge = saved.body.challenge as { name: string; value: string };
    expect(challenge.name).toBe(`_resget-verify.${host}`);
    expect(challenge.value).toMatch(/^resget-verify=[0-9a-f]{32}$/);
    // The host reaches the platform, but no proof (or someone else's) is published: not verified.
    const bare = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/domain/verify`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(bare.body.verifiedAt).toBeNull();
    expect(bare.body.lastCheck).toMatchObject({ ok: false, ownershipProven: false });
    verifier.publish(challenge.name, 'resget-verify=0123456789abcdef0123456789abcdef');
    const foreign = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/domain/verify`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(foreign.body.verifiedAt).toBeNull();
    verifier.publish(challenge.name, challenge.value);
    const proven = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/domain/verify`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(proven.body.verifiedAt).not.toBeNull();
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/domain`)
      .set(bearer(ownerToken, restaurantId))
      .send({ domain: null })
      .expect(200);
  });

  it('keeps the record but stops serving on BASIC, and clears on request', async () => {
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/domain`)
      .set(bearer(ownerToken, restaurantId))
      .send({ domain })
      .expect(200);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/domain/verify`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    await ctx.http().get(`/public/domains/resolve?host=${domain}`).expect(200);

    if (subscriptionId) {
      await ctx.prisma.restaurantSubscription.update({
        where: { id: subscriptionId },
        data: { trialEndsAt: new Date(Date.now() - 1000) },
      });
      await ctx.http().get(`/public/domains/resolve?host=${domain}`).expect(404);
      await ctx
        .http()
        .put(`/restaurants/${restaurantId}/domain`)
        .set(bearer(ownerToken, restaurantId))
        .send({ domain: null })
        .expect(403)
        .expect('x-error-code', 'PLAN_FEATURE_REQUIRED');
      const status = await ctx
        .http()
        .get(`/restaurants/${restaurantId}/domain`)
        .set(bearer(ownerToken, restaurantId))
        .expect(200);
      expect(status.body.domain).toBe(domain);
      expect(status.body.verifiedAt).not.toBeNull();
      expect(status.body.active).toBe(false);
      await ctx.prisma.restaurantSubscription.update({ where: { id: subscriptionId }, data: { trialEndsAt } });
    }

    const cleared = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/domain`)
      .set(bearer(ownerToken, restaurantId))
      .send({ domain: null })
      .expect(200);
    expect(cleared.body.domain).toBeNull();
    await ctx.http().get(`/public/domains/resolve?host=${domain}`).expect(404);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/domain/verify`)
      .set(bearer(ownerToken, restaurantId))
      .expect(409)
      .expect('x-error-code', 'DOMAIN_NOT_SET');
  });
});
