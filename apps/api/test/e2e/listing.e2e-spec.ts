import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { deleteTestRestaurants } from './support/cleanup';

/** Marketplace listing request and review (docs/PLATFORM_YONETIMI.md). */
describe('Listing request and review (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let newOwnerToken: string;
  let restaurantId: string;
  let emptyRestaurantId: string | null = null;
  const newOwnerPhone = normalizePhone('05320000031')!;
  let original: {
    isListed: boolean;
    listingRequestedAt: Date | null;
    listingReviewedAt: Date | null;
    listingReviewNote: string | null;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login(SEED.superAdminPhone);
    ownerToken = await ctx.login(SEED.ownerPhone);
    await ctx.prisma.user.deleteMany({ where: { phone: newOwnerPhone } });
    newOwnerToken = await ctx.login(newOwnerPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, isListed: true, listingRequestedAt: true, listingReviewedAt: true, listingReviewNote: true },
    });
    restaurantId = restaurant.id;
    original = restaurant;
  });

  afterAll(async () => {
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: original });
    if (emptyRestaurantId) await deleteTestRestaurants(ctx.prisma, { id: emptyRestaurantId });
    await ctx.prisma.user.deleteMany({ where: { phone: newOwnerPhone } });
    await ctx.close();
  });

  it('a listed restaurant cannot request again; an unlisted one with a menu can, and the console sees it pending', async () => {
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/listing-request`)
      .set(bearer(ownerToken))
      .expect(409)
      .expect('x-error-code', 'ALREADY_LISTED');
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { isListed: false, listingRequestedAt: null, listingReviewedAt: null, listingReviewNote: null },
    });
    const requested = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/listing-request`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(requested.body.isListed).toBe(false);
    expect(requested.body.listingRequestedAt).not.toBeNull();
    expect(requested.body.listingReviewedAt).toBeNull();

    const pending = await ctx.http().get('/admin/restaurants?pending=true').set(bearer(adminToken)).expect(200);
    const row = pending.body.items.find((r: { id: string }) => r.id === restaurantId);
    expect(row).toBeDefined();
    expect(row.menu.availableItems).toBeGreaterThan(0);
    const overview = await ctx.http().get('/admin/overview').set(bearer(adminToken)).expect(200);
    expect(overview.body.pendingListingRequests).toBeGreaterThanOrEqual(1);
  });

  it('declining with a note records the decision, messages the owner, and the owner may ask again', async () => {
    const declined = await ctx
      .http()
      .patch(`/admin/restaurants/${restaurantId}`)
      .set(bearer(adminToken))
      .send({ isListed: false, listingReviewNote: 'Menude fotograf yok.' })
      .expect(200);
    expect(declined.body.isListed).toBe(false);
    expect(declined.body.listingReviewedAt).not.toBeNull();
    expect(declined.body.listingReviewNote).toBe('Menude fotograf yok.');
    const log = await ctx.prisma.messageLog.findFirst({
      where: { restaurantId, templateKey: 'listing.declined' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log?.creditsCharged).toBe(0);
    const settings = await ctx.http().get(`/restaurants/${restaurantId}`).set(bearer(ownerToken)).expect(200);
    expect(settings.body.listingReviewNote).toBe('Menude fotograf yok.');
    const pending = await ctx.http().get('/admin/restaurants?pending=true').set(bearer(adminToken)).expect(200);
    expect(pending.body.items.some((r: { id: string }) => r.id === restaurantId)).toBe(false);

    const again = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/listing-request`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(again.body.listingReviewedAt).toBeNull();
    expect(again.body.listingReviewNote).toBeNull();
  });

  it('approving lists the restaurant and messages the owner', async () => {
    const approved = await ctx
      .http()
      .patch(`/admin/restaurants/${restaurantId}`)
      .set(bearer(adminToken))
      .send({ isListed: true })
      .expect(200);
    expect(approved.body.isListed).toBe(true);
    expect(approved.body.listingReviewedAt).not.toBeNull();
    const log = await ctx.prisma.messageLog.findFirst({
      where: { restaurantId, templateKey: 'listing.approved' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
  });

  it('a restaurant without a menu cannot request a listing', async () => {
    const created = await ctx
      .http()
      .post('/admin/restaurants')
      .set(bearer(adminToken))
      .send({
        name: 'Bos Menu Lokantasi',
        countryCode: 'TR',
        currency: 'TRY',
        timezone: 'Europe/Istanbul',
        defaultLocale: 'tr',
        branch: { addressLine: 'Test Sok. No 5', city: 'Istanbul', district: 'Kadikoy' },
        ownerPhone: newOwnerPhone,
        ownerName: 'Bos Menu Sahibi',
      })
      .expect(201);
    emptyRestaurantId = created.body.restaurantId ?? created.body.id;
    const freshToken = await ctx.login(newOwnerPhone);
    await ctx
      .http()
      .post(`/restaurants/${emptyRestaurantId}/listing-request`)
      .set(bearer(freshToken))
      .expect(409)
      .expect('x-error-code', 'LISTING_NOT_READY');
    void newOwnerToken;
  });
});
