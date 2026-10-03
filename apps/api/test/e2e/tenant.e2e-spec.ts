import { ERROR_CODE_HEADER } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

describe('Tenant isolation (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let otherRestaurantId: string;
  let ownerToken: string;
  let guestToken: string;
  let superAdminToken: string;
  let counterToken: string;
  const counterPhone = '+905329990002';

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } });
    restaurantId = restaurant.id;
    // Leftovers of an earlier run against the same database.
    await ctx.prisma.restaurant.deleteMany({ where: { slug: 'e2e-diger' } });
    await ctx.prisma.otpCode.deleteMany({ where: { phone: counterPhone } });
    await ctx.prisma.user.deleteMany({ where: { phone: counterPhone } });
    const other = await ctx.prisma.restaurant.create({
      data: { slug: 'e2e-diger', name: 'E2E Diger', countryCode: 'TR', currency: 'TRY', timezone: 'Europe/Istanbul' },
    });
    otherRestaurantId = other.id;
    // A counter employee: menu.view and orders.*, but no tables.manage.
    const counterRole = await ctx.prisma.roleTemplate.findFirstOrThrow({
      where: { restaurantId, templateKey: 'counter' },
    });
    const counter = await ctx.prisma.user.create({ data: { phone: counterPhone, fullName: 'E2E Kasa' } });
    await ctx.prisma.membership.create({
      data: {
        userId: counter.id,
        restaurantId,
        roleTemplateId: counterRole.id,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    [ownerToken, guestToken, superAdminToken, counterToken] = await Promise.all([
      ctx.login(SEED.ownerPhone),
      ctx.login(SEED.guestPhone),
      ctx.login(SEED.superAdminPhone),
      ctx.login(counterPhone),
    ]);
  });

  afterAll(async () => {
    await ctx.prisma.restaurant.deleteMany({ where: { id: otherRestaurantId } });
    await ctx.prisma.otpCode.deleteMany({ where: { phone: counterPhone } });
    await ctx.prisma.user.deleteMany({ where: { phone: counterPhone } });
    await ctx.close();
  });

  it('requires a token', async () => {
    const res = await ctx.http().get(`/restaurants/${restaurantId}`).expect(401);
    expect(res.headers[ERROR_CODE_HEADER]).toBe('UNAUTHORIZED');
  });

  it('lets the owner read the restaurant with every permission and the plan', async () => {
    const res = await ctx.http().get(`/restaurants/${restaurantId}`).set(bearer(ownerToken)).expect(200);
    expect(res.body.slug).toBe(SEED.restaurantSlug);
    expect(res.body.effectivePlan).toBe('PRO');
    expect(res.body.permissions).toContain('tables.manage');
    expect(res.body.commissionBps).toBe(100);
  });

  it('refuses a user without a membership and a member of another restaurant', async () => {
    const guest = await ctx.http().get(`/restaurants/${restaurantId}`).set(bearer(guestToken)).expect(403);
    expect(guest.body.code).toBe('FORBIDDEN');
    const owner = await ctx.http().get(`/restaurants/${otherRestaurantId}`).set(bearer(ownerToken)).expect(403);
    expect(owner.body.code).toBe('FORBIDDEN');
  });

  it('refuses conflicting restaurant ids between the route and the header', async () => {
    await ctx.http().get(`/restaurants/${restaurantId}`).set(bearer(ownerToken, otherRestaurantId)).expect(403);
  });

  it('a super admin reads any restaurant without a membership', async () => {
    await ctx.http().get(`/restaurants/${otherRestaurantId}`).set(bearer(superAdminToken)).expect(200);
  });

  it('enforces permissions per role: counter sees the menu but not the tables', async () => {
    await ctx.http().get(`/restaurants/${restaurantId}/menu`).set(bearer(counterToken)).expect(200);
    const res = await ctx.http().get(`/restaurants/${restaurantId}/tables`).set(bearer(counterToken)).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('refuses an inactive membership', async () => {
    await ctx.prisma.membership.updateMany({ where: { user: { phone: counterPhone } }, data: { status: 'PASSIVE' } });
    const res = await ctx.http().get(`/restaurants/${restaurantId}/menu`).set(bearer(counterToken)).expect(403);
    expect(res.body.code).toBe('MEMBERSHIP_NOT_ACTIVE');
  });
});
