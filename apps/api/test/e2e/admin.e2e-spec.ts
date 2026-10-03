import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Restaurant self sign-up and the platform owner's console (docs/PLATFORM_YONETIMI.md). */
describe('Sign-up and super admin (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let newOwnerToken: string;
  const newOwnerPhone = normalizePhone('05320000009')!;
  const createdRestaurantIds: string[] = [];
  let areaId: string | null = null;
  const district = `E2E Ilce ${Date.now().toString(36)}`;

  const signupBody = (name: string, slug?: string) => ({
    name,
    ...(slug ? { slug } : {}),
    countryCode: 'TR',
    currency: 'TRY',
    timezone: 'Europe/Istanbul',
    defaultLocale: 'tr',
    branch: { addressLine: 'Test Sok. No 1', city: 'Istanbul', district },
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login(SEED.superAdminPhone);
    ownerToken = await ctx.login(SEED.ownerPhone);
    await ctx.prisma.user.deleteMany({ where: { phone: newOwnerPhone } });
    newOwnerToken = await ctx.login(newOwnerPhone);
  });

  afterAll(async () => {
    if (createdRestaurantIds.length)
      await ctx.prisma.restaurant.deleteMany({ where: { id: { in: createdRestaurantIds } } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: [newOwnerPhone, normalizePhone('05320000010')!] } } });
    if (areaId) await ctx.prisma.serviceArea.deleteMany({ where: { id: areaId } });
    await ctx.prisma.messageCreditPackage.deleteMany({ where: { code: 'e2e-sms-10' } });
    await ctx.close();
  });

  it('provisions a restaurant for the signed-in owner with roles, trial and welcome credits', async () => {
    const res = await ctx
      .http()
      .post('/restaurants')
      .set(bearer(newOwnerToken))
      .send(signupBody('Çınaraltı Köfte'))
      .expect(201);
    createdRestaurantIds.push(res.body.id as string);
    expect(res.body.slug).toBe('cinaralti-kofte');
    const [roles, membership, subscription, wallets] = await Promise.all([
      ctx.prisma.roleTemplate.count({ where: { restaurantId: res.body.id } }),
      ctx.prisma.membership.findFirstOrThrow({ where: { restaurantId: res.body.id }, include: { roleTemplate: true } }),
      ctx.prisma.restaurantSubscription.findUniqueOrThrow({
        where: { restaurantId: res.body.id },
        include: { plan: true },
      }),
      ctx.prisma.messageWallet.findMany({ where: { restaurantId: res.body.id } }),
    ]);
    expect(roles).toBe(5);
    expect(membership.roleTemplate.isOwner).toBe(true);
    expect(membership.status).toBe('ACTIVE');
    expect(subscription.plan.code).toBe('PRO');
    expect(subscription.status).toBe('TRIALING');
    expect(wallets.map((w) => w.balance)).toEqual([25, 25]);
    const me = await ctx.http().get('/auth/me').set(bearer(newOwnerToken)).expect(200);
    expect(me.body.memberships.some((m: { restaurantSlug: string }) => m.restaurantSlug === 'cinaralti-kofte')).toBe(
      true,
    );
    // The owner can open the panel endpoints of the new restaurant straight away.
    await ctx.http().get(`/restaurants/${res.body.id}/menu/manage`).set(bearer(newOwnerToken)).expect(200);
  });

  it('suffixes a derived slug and refuses a chosen one that is taken', async () => {
    const second = await ctx
      .http()
      .post('/restaurants')
      .set(bearer(newOwnerToken))
      .send(signupBody('Çınaraltı Köfte'))
      .expect(201);
    createdRestaurantIds.push(second.body.id as string);
    expect(second.body.slug).toBe('cinaralti-kofte-2');
    await ctx
      .http()
      .post('/restaurants')
      .set(bearer(newOwnerToken))
      .send(signupBody('Baska', 'demo-lokanta'))
      .expect(409)
      .expect('x-error-code', 'SLUG_TAKEN');
  });

  it('keeps the console closed to restaurant owners', async () => {
    await ctx.http().get('/admin/overview').set(bearer(ownerToken)).expect(403);
    await ctx.http().get('/admin/restaurants').set(bearer(newOwnerToken)).expect(403);
  });

  it('lists restaurants, changes platform fields and grants credits', async () => {
    const list = await ctx.http().get('/admin/restaurants?query=cinaralti').set(bearer(adminToken)).expect(200);
    expect(list.body.total).toBeGreaterThanOrEqual(2);
    const row = list.body.items.find((r: { slug: string }) => r.slug === 'cinaralti-kofte');
    expect(row.isListed).toBe(false);
    expect(row.owner.phone).toBe(newOwnerPhone);
    const updated = await ctx
      .http()
      .patch(`/admin/restaurants/${row.id}`)
      .set(bearer(adminToken))
      .send({ isListed: true, commissionBps: 150, pspPercentBps: 180, pspFixedMinor: 25 })
      .expect(200);
    expect(updated.body.isListed).toBe(true);
    expect(updated.body.commissionBps).toBe(150);
    const credits = await ctx
      .http()
      .post(`/admin/restaurants/${row.id}/credits`)
      .set(bearer(adminToken))
      .send({ channel: 'SMS', credits: 100, note: 'e2e grant' })
      .expect(200);
    expect(credits.body.balance).toBe(125);
    const audit = await ctx.prisma.auditLog.findMany({ where: { restaurantId: row.id }, select: { action: true } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['restaurant.created', 'restaurant.updated', 'credits.granted']),
    );
  });

  it('creates a restaurant for an owner by phone from the console', async () => {
    const res = await ctx
      .http()
      .post('/admin/restaurants')
      .set(bearer(adminToken))
      .send({ ...signupBody('Konsol Lokantasi'), ownerPhone: '0532 000 00 10', ownerName: 'Konsol Sahip' })
      .expect(201);
    createdRestaurantIds.push(res.body.id as string);
    const owner = await ctx.prisma.membership.findFirstOrThrow({
      where: { restaurantId: res.body.id },
      include: { user: true },
    });
    expect(owner.user.phone).toBe(normalizePhone('05320000010'));
    expect(owner.user.fullName).toBe('Konsol Sahip');
  });

  it('creates and launches a service area, attaching restaurants already in the district', async () => {
    const created = await ctx
      .http()
      .post('/admin/service-areas')
      .set(bearer(adminToken))
      .send({ countryCode: 'TR', city: 'Istanbul', district })
      .expect(201);
    areaId = created.body.id as string;
    expect(created.body.isLaunched).toBe(false);
    expect(created.body.restaurants).toBeGreaterThanOrEqual(3);
    await ctx
      .http()
      .post('/admin/service-areas')
      .set(bearer(adminToken))
      .send({ countryCode: 'TR', city: 'Istanbul', district })
      .expect(409)
      .expect('x-error-code', 'SERVICE_AREA_EXISTS');
    const launched = await ctx
      .http()
      .patch(`/admin/service-areas/${areaId}`)
      .set(bearer(adminToken))
      .send({ isLaunched: true })
      .expect(200);
    expect(launched.body.isLaunched).toBe(true);
    expect(launched.body.launchedAt).toBeTruthy();
    const overview = await ctx.http().get('/admin/overview?days=30').set(bearer(adminToken)).expect(200);
    const bucket = overview.body.density.find((d: { district: string }) => d.district === district);
    expect(bucket.isLaunched).toBe(true);
    expect(bucket.restaurants).toBeGreaterThanOrEqual(3);
    expect(overview.body.restaurants).toBeGreaterThanOrEqual(4);
  });

  it('edits plans and upserts credit packages', async () => {
    const plans = await ctx.http().get('/admin/plans').set(bearer(adminToken)).expect(200);
    const pro = plans.body.find((p: { code: string }) => p.code === 'PRO');
    const before = pro.trialDays as number;
    const updated = await ctx
      .http()
      .patch(`/admin/plans/${pro.id}`)
      .set(bearer(adminToken))
      .send({ trialDays: 60 })
      .expect(200);
    expect(updated.body.trialDays).toBe(60);
    await ctx.http().patch(`/admin/plans/${pro.id}`).set(bearer(adminToken)).send({ trialDays: before }).expect(200);
    const pkg = await ctx
      .http()
      .put('/admin/credit-packages')
      .set(bearer(adminToken))
      .send({ code: 'e2e-sms-10', channel: 'SMS', credits: 10, priceMinor: 1000, currency: 'TRY', isActive: false })
      .expect(200);
    expect(pkg.body.isActive).toBe(false);
    const again = await ctx
      .http()
      .put('/admin/credit-packages')
      .set(bearer(adminToken))
      .send({ code: 'e2e-sms-10', channel: 'SMS', credits: 20, priceMinor: 1000, currency: 'TRY', isActive: true })
      .expect(200);
    expect(again.body.id).toBe(pkg.body.id);
    expect(again.body.credits).toBe(20);
  });
});
