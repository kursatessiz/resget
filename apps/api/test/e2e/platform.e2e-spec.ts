import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const EDITOR_PHONE = normalizePhone('05329990961')!;

/** Platform marketing access (docs/PAZARLAMA.md): platform tenant, locked roles, console, marketing shell context. */
describe('Platform marketing access (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let platformId: string;

  const setSwitch = (enabled: boolean | null) =>
    ctx.http().put('/admin/features/marketing_platform').set(bearer(adminToken)).send({ enabled }).expect(200);
  const setup = () =>
    ctx
      .http()
      .post('/admin/platform/setup')
      .set(bearer(adminToken))
      .send({ name: 'Platform', countryCode: 'TR', currency: 'TRY', timezone: 'Europe/Istanbul', defaultLocale: 'tr' });

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    await ctx.prisma.restaurant.deleteMany({ where: { isPlatform: true } });
  });

  afterAll(async () => {
    await ctx.prisma.featureFlag.deleteMany({ where: { key: 'marketing_platform' } });
    await ctx.prisma.restaurant.deleteMany({ where: { isPlatform: true } });
    await ctx.prisma.auditLog.deleteMany({ where: { action: { startsWith: 'platform.' } } });
    await ctx.close();
  });

  it('is for the console only and starts without a platform tenant', async () => {
    await ctx.http().get('/admin/platform').set(bearer(ownerToken)).expect(403);
    const empty = await ctx.http().get('/admin/platform').set(bearer(adminToken)).expect(200);
    expect(empty.body).toMatchObject({ tenant: null, enabled: false, users: [] });
    const context = await ctx.http().get('/platform/context').set(bearer(adminToken)).expect(404);
    expect(context.body.code).toBe('PLATFORM_NOT_SET_UP');
  });

  it('sets the platform tenant up once, keeps it out of the restaurant lists and the storefront', async () => {
    const first = await setup().expect(200);
    expect(first.body.tenant).toMatchObject({ slug: 'platform', currency: 'TRY' });
    platformId = first.body.tenant.id as string;
    const again = await setup().expect(200);
    expect(again.body.tenant.id).toBe(platformId);
    expect(await ctx.prisma.restaurant.count({ where: { isPlatform: true } })).toBe(1);
    expect(
      await ctx.prisma.roleTemplate.count({
        where: { restaurantId: platformId, systemKey: { startsWith: 'platform:' } },
      }),
    ).toBe(3);

    const listed = await ctx.http().get('/admin/restaurants?pageSize=100').set(bearer(adminToken)).expect(200);
    expect((listed.body.items as { id: string }[]).map((r) => r.id)).not.toContain(platformId);
    // The slug is reserved, so the storefront refuses it before any lookup.
    await ctx.http().get('/public/restaurants/platform/menu').expect(400);
    // Off by default: nobody opens the marketing shell yet.
    const off = await ctx.http().get('/platform/context').set(bearer(adminToken)).expect(403);
    expect(off.body.code).toBe('FEATURE_DISABLED');
  });

  it('adds a marketing editor who reaches marketing screens but never roles, staff or money', async () => {
    await setSwitch(true);
    const invited = await ctx
      .http()
      .post('/admin/platform/users')
      .set(bearer(adminToken))
      .send({ phone: EDITOR_PHONE, fullName: 'Pazarlama Editoru', role: 'marketing_editor' })
      .expect(200);
    expect(invited.body.users).toEqual([expect.objectContaining({ role: 'marketing_editor', active: true })]);

    const editorToken = await ctx.login(EDITOR_PHONE);
    const me = await ctx.http().get('/auth/me').set(bearer(editorToken)).expect(200);
    expect(me.body.platform).toEqual({ role: 'marketing_editor' });
    expect((me.body.memberships as { restaurantId: string }[]).map((m) => m.restaurantId)).not.toContain(platformId);

    const context = await ctx.http().get('/platform/context').set(bearer(editorToken)).expect(200);
    expect(context.body).toMatchObject({ restaurantId: platformId, role: 'marketing_editor', isSuperAdmin: false });
    expect(context.body.permissions).toEqual(['platform.marketing.view', 'platform.marketing.manage']);

    await ctx.http().get(`/restaurants/${platformId}/customers`).set(bearer(editorToken, platformId)).expect(200);
    await ctx.http().get(`/restaurants/${platformId}/staff`).set(bearer(editorToken, platformId)).expect(403);
    // Not even the super admin manages staff or roles of the platform tenant from the panel.
    await ctx.http().get(`/restaurants/${platformId}/staff`).set(bearer(adminToken, platformId)).expect(403);
    await ctx
      .http()
      .patch(`/restaurants/${platformId}`)
      .set(bearer(adminToken, platformId))
      .send({ name: 'X' })
      .expect(403);
    const admin = await ctx.http().get('/platform/context').set(bearer(adminToken)).expect(200);
    expect(admin.body).toMatchObject({ isSuperAdmin: true, role: null });

    // With the module off the platform tenant is closed for its members too.
    await setSwitch(false);
    const closed = await ctx
      .http()
      .get(`/restaurants/${platformId}/customers`)
      .set(bearer(editorToken, platformId))
      .expect(403);
    expect(closed.body.code).toBe('FEATURE_DISABLED');
    await setSwitch(true);
  });

  it('changes the role and deactivates a platform user from the console', async () => {
    const state = await ctx.http().get('/admin/platform').set(bearer(adminToken)).expect(200);
    const membershipId = (state.body.users as { membershipId: string }[])[0].membershipId;
    const viewer = await ctx
      .http()
      .patch(`/admin/platform/users/${membershipId}`)
      .set(bearer(adminToken))
      .send({ role: 'marketing_viewer' })
      .expect(200);
    expect(viewer.body.users[0]).toMatchObject({ role: 'marketing_viewer' });
    const editorToken = await ctx.login(EDITOR_PHONE);
    expect((await ctx.http().get('/platform/context').set(bearer(editorToken)).expect(200)).body.permissions).toEqual([
      'platform.marketing.view',
    ]);

    await ctx
      .http()
      .patch(`/admin/platform/users/${membershipId}`)
      .set(bearer(adminToken))
      .send({ active: false })
      .expect(200);
    const denied = await ctx.http().get('/platform/context').set(bearer(editorToken)).expect(403);
    expect(denied.body.code).toBe('PLATFORM_ACCESS_DENIED');
    expect(await ctx.prisma.auditLog.count({ where: { action: { startsWith: 'platform.user.' } } })).toBe(3);
    await setSwitch(null);
  });
});
