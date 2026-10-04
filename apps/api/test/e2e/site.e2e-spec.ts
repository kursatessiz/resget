import type { DistrictLandingDTO, PublicSitePageDTO, RestaurantSeoDTO, SitePageDTO, SitemapDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Page engine and technical SEO (docs/SAYFA_MOTORU.md, docs/SEO.md): platform-only pages, switch, public reads. */
describe('Page engine and SEO (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let platformId: string;
  let restaurantId: string;
  const pages = () => `/restaurants/${platformId}/site/pages`;
  const publicPage = (locale: string, path: string) =>
    ctx.http().get(`/public/site/page?${new URLSearchParams({ locale, path }).toString()}`);
  const switchFor = (id: string, enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${id}/features/page_engine`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);

  const page = (overrides: Record<string, unknown> = {}) => ({
    path: 'restoranlar-icin',
    locale: 'tr',
    title: 'Restoranlar için düşük komisyonlu sipariş',
    description: 'Yüzde bir komisyonla masa QR, kendi sipariş sayfanız ve pazaryeri; kurulum ücreti yok.',
    translationKey: 'for-restaurants',
    blocks: [
      { type: 'hero', heading: 'Siparişleriniz sizin', ctaLabel: 'Başvur', ctaHref: '/kayit' },
      { type: 'faq', items: [{ question: 'Komisyon ne kadar?', answer: 'Sipariş başına yüzde bir.' }] },
      { type: 'restaurants', heading: 'Kadıköy', area: 'TR|Istanbul|Kadikoy' },
    ],
    ...overrides,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    await ctx.prisma.restaurant.deleteMany({ where: { isPlatform: true } });
    const setup = await ctx
      .http()
      .post('/admin/platform/setup')
      .set(bearer(adminToken))
      .send({ name: 'Platform', countryCode: 'TR', currency: 'TRY', timezone: 'Europe/Istanbul', defaultLocale: 'tr' })
      .expect(200);
    platformId = setup.body.tenant.id as string;
    await ctx
      .http()
      .put('/admin/features/marketing_platform')
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    restaurantId = (
      await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug }, select: { id: true } })
    ).id;
  });

  afterAll(async () => {
    await ctx.prisma.featureFlag.deleteMany({ where: { key: { in: ['page_engine', 'marketing_platform'] } } });
    await ctx.prisma.restaurant.deleteMany({ where: { isPlatform: true } });
    await ctx.prisma.auditLog.deleteMany({ where: { action: { startsWith: 'platform.' } } });
    await ctx.close();
  });

  it('keeps everything behind the switch, which starts off', async () => {
    await ctx.http().get(pages()).set(bearer(adminToken, platformId)).expect(403);
    await publicPage('tr', 'restoranlar-icin').expect(404);
    await ctx.http().get('/public/site/districts/istanbul/kadikoy').expect(404);
    const map = (await ctx.http().get('/public/site/sitemap').expect(200)).body as SitemapDTO;
    expect(map.entries).toEqual([]);
  });

  it('serves restaurant SEO always, with structured data only when the switch is on for it', async () => {
    const off = (await ctx.http().get(`/public/site/restaurants/${SEED.restaurantSlug}`).expect(200))
      .body as RestaurantSeoDTO;
    expect(off).toMatchObject({ slug: SEED.restaurantSlug, structuredData: false, customDomain: null });
    expect(off.address).toMatchObject({ district: 'Kadikoy', city: 'Istanbul', countryCode: 'TR' });
    await switchFor(restaurantId, true);
    const on = (await ctx.http().get(`/public/site/restaurants/${SEED.restaurantSlug}`).expect(200))
      .body as RestaurantSeoDTO;
    expect(on.structuredData).toBe(true);
    await switchFor(restaurantId, null);
    // The platform tenant is not a restaurant page.
    const platformSlug = (
      await ctx.prisma.restaurant.update({ where: { id: platformId }, data: { slug: 'platform-site-e2e' } })
    ).slug;
    await ctx.http().get(`/public/site/restaurants/${platformSlug}`).expect(404);
    await ctx.prisma.restaurant.update({ where: { id: platformId }, data: { slug: 'platform' } });
  });

  it('lets platform marketing build pages and refuses them on a restaurant', async () => {
    await switchFor(platformId, true);
    await switchFor(restaurantId, true);
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/site/pages`)
      .set(bearer(ownerToken, restaurantId))
      .expect(403)
      .expect('x-error-code', 'PLATFORM_ONLY');
    await switchFor(restaurantId, null);

    // Invalid input: an unsafe link and a bad path.
    await ctx
      .http()
      .post(pages())
      .set(bearer(adminToken, platformId))
      .send(page({ blocks: [{ type: 'cta', heading: 'X', label: 'Y', href: 'javascript:alert(1)' }] }))
      .expect(400);
    await ctx
      .http()
      .post(pages())
      .set(bearer(adminToken, platformId))
      .send(page({ path: 'Bad Path' }))
      .expect(400);

    const draft = (await ctx.http().post(pages()).set(bearer(adminToken, platformId)).send(page()).expect(201))
      .body as SitePageDTO;
    expect(draft).toMatchObject({ status: 'DRAFT', publishedAt: null, translationKey: 'for-restaurants' });
    await ctx
      .http()
      .post(pages())
      .set(bearer(adminToken, platformId))
      .send(page())
      .expect(409)
      .expect('x-error-code', 'SITE_PAGE_PATH_TAKEN');
    // Drafts are not public.
    await publicPage('tr', 'restoranlar-icin').expect(404);

    const published = (
      await ctx
        .http()
        .put(`${pages()}/${draft.id}`)
        .set(bearer(adminToken, platformId))
        .send(page({ status: 'PUBLISHED' }))
        .expect(200)
    ).body as SitePageDTO;
    expect(published.publishedAt).not.toBeNull();
    await ctx
      .http()
      .post(pages())
      .set(bearer(adminToken, platformId))
      .send(
        page({
          locale: 'en',
          path: 'for-restaurants',
          title: 'Low commission ordering for restaurants',
          description: 'One percent commission with table QR, your own ordering page and the marketplace.',
          status: 'PUBLISHED',
          blocks: [{ type: 'text', body: 'Orders are yours.' }],
        }),
      )
      .expect(201);

    const list = (await ctx.http().get(pages()).set(bearer(adminToken, platformId)).expect(200)).body as SitePageDTO[];
    expect(list.map((p) => `${p.locale}/${p.path}`)).toEqual(['en/for-restaurants', 'tr/restoranlar-icin']);
  });

  it('renders a published page with its translations and the restaurants of a launched district', async () => {
    const tr = (await publicPage('tr', 'restoranlar-icin').expect(200)).body as PublicSitePageDTO;
    expect(tr.alternates).toEqual([{ locale: 'en', path: 'for-restaurants' }]);
    const block = tr.blocks.find((b) => b.type === 'restaurants');
    expect(block && 'restaurants' in block ? block.restaurants.map((r) => r.slug) : []).toContain(SEED.restaurantSlug);
    await publicPage('de', 'restoranlar-icin').expect(404);
    await ctx.http().get('/public/site/page?locale=tr&path=..%2Fadmin').expect(400);
  });

  it('builds district landing pages and the sitemap', async () => {
    const landing = (await ctx.http().get('/public/site/districts/istanbul/kadikoy').expect(200))
      .body as DistrictLandingDTO;
    expect(landing).toMatchObject({ city: 'Istanbul', district: 'Kadikoy', path: '/ilce/istanbul/kadikoy' });
    expect(landing.restaurants.map((r) => r.slug)).toContain(SEED.restaurantSlug);
    await ctx.http().get('/public/site/districts/istanbul/besiktas').expect(404);

    const map = (await ctx.http().get('/public/site/sitemap').expect(200)).body as SitemapDTO;
    const paths = map.entries.map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/',
        '/pazaryeri',
        '/ilce/istanbul/kadikoy',
        `/${SEED.restaurantSlug}`,
        '/p/tr/restoranlar-icin',
        '/p/en/for-restaurants',
      ]),
    );
    expect(paths).not.toContain('/platform');
    expect(map.entries.find((e) => e.path === '/p/tr/restoranlar-icin')?.alternates).toEqual({
      tr: '/p/tr/restoranlar-icin',
      en: '/p/en/for-restaurants',
    });
  });

  it('deletes pages', async () => {
    const list = (await ctx.http().get(pages()).set(bearer(adminToken, platformId)).expect(200)).body as SitePageDTO[];
    for (const p of list) await ctx.http().delete(`${pages()}/${p.id}`).set(bearer(adminToken, platformId)).expect(204);
    await publicPage('tr', 'restoranlar-icin').expect(404);
    await ctx
      .http()
      .get(`${pages()}/${list[0].id}`)
      .set(bearer(adminToken, platformId))
      .expect(404)
      .expect('x-error-code', 'SITE_PAGE_NOT_FOUND');
  });
});
