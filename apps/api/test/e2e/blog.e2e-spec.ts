import './support/indexnow-mock';
import type { BlogIndexDTO, LlmsDTO, PublicSitePageDTO, SitePageDTO, SitemapDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { IndexNowService } from '../../src/modules/site/indexnow.service';

/** Blog, IndexNow and llms.txt (docs/BLOG.md, docs/SEO.md). */
describe('Blog, IndexNow and llms (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let platformId: string;
  let indexNow: IndexNowService;
  const pages = () => `/restaurants/${platformId}/site/pages`;
  const as = () => bearer(adminToken, platformId);
  const switchFor = (key: string, enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${platformId}/features/${key}`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  /** Pings are fire and forget: wait for the next batch to land. */
  const nextPing = async (before: number): Promise<string[]> => {
    for (let i = 0; i < 50 && indexNow.submitted.length <= before; i++) await new Promise((r) => setTimeout(r, 20));
    expect(indexNow.submitted.length).toBeGreaterThan(before);
    return indexNow.submitted[indexNow.submitted.length - 1];
  };
  const post = (overrides: Record<string, unknown> = {}) => ({
    kind: 'POST',
    path: 'masa-qr-menu',
    locale: 'tr',
    title: 'Masa QR menü nasıl kurulur',
    description: 'Masa QR menüyü on dakikada kurmanın adımları ve sık yapılan hatalar.',
    status: 'PUBLISHED',
    blocks: [{ type: 'text', body: 'Önce menüyü yükleyin.\n\nSonra masaları ekleyin.' }],
    ...overrides,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    indexNow = ctx.app.get(IndexNowService);
    adminToken = await ctx.login(SEED.superAdminPhone);
    await ctx.prisma.restaurant.deleteMany({ where: { isPlatform: true } });
    const setup = await ctx
      .http()
      .post('/admin/platform/setup')
      .set(bearer(adminToken))
      .send({ name: 'Resget', countryCode: 'TR', currency: 'TRY', timezone: 'Europe/Istanbul', defaultLocale: 'tr' })
      .expect(200);
    platformId = setup.body.tenant.id as string;
    await switchFor('marketing_platform', true);
    await switchFor('page_engine', true);
  });

  afterAll(async () => {
    await ctx.prisma.featureFlag.deleteMany({ where: { key: { in: ['page_engine', 'blog', 'marketing_platform'] } } });
    await ctx.prisma.restaurant.deleteMany({ where: { isPlatform: true } });
    await ctx.prisma.auditLog.deleteMany({ where: { action: { startsWith: 'platform.' } } });
    await ctx.close();
  });

  it('keeps posts behind their own switch', async () => {
    await ctx.http().post(pages()).set(as()).send(post()).expect(403).expect('x-error-code', 'FEATURE_DISABLED');
    await ctx.http().get('/public/site/blog').expect(404);
    await switchFor('blog', true);
    // A post's address is one segment.
    await ctx
      .http()
      .post(pages())
      .set(as())
      .send(post({ path: 'rehber/qr' }))
      .expect(400);
  });

  it('publishes a post, pings IndexNow and serves it under /blog', async () => {
    const before = indexNow.submitted.length;
    const created = (await ctx.http().post(pages()).set(as()).send(post()).expect(201)).body as SitePageDTO;
    expect(created).toMatchObject({ kind: 'POST', authorName: null, status: 'PUBLISHED' });
    expect(await nextPing(before)).toEqual([
      'http://localhost:3000/blog/tr/masa-qr-menu',
      'http://localhost:3000/blog',
    ]);

    const page = (await ctx.http().get('/public/site/page?locale=tr&path=masa-qr-menu&kind=POST').expect(200))
      .body as PublicSitePageDTO;
    expect(page).toMatchObject({ kind: 'POST', authorName: 'Resget', authorIsSite: true });
    expect(page.publishedAt).not.toBeNull();
    // A post is not a page.
    await ctx.http().get('/public/site/page?locale=tr&path=masa-qr-menu').expect(404);

    const index = (await ctx.http().get('/public/site/blog').expect(200)).body as BlogIndexDTO;
    expect(index.siteName).toBe('Resget');
    expect(index.posts.map((p) => p.path)).toEqual(['masa-qr-menu']);

    // Renaming pings the old and the new address; a draft is not pinged again.
    const renamed = indexNow.submitted.length;
    await ctx
      .http()
      .put(`${pages()}/${created.id}`)
      .set(as())
      .send(post({ path: 'qr-menu-rehberi', authorName: 'Ayse Yilmaz' }))
      .expect(200);
    expect(await nextPing(renamed)).toEqual([
      'http://localhost:3000/blog/tr/masa-qr-menu',
      'http://localhost:3000/blog',
      'http://localhost:3000/blog/tr/qr-menu-rehberi',
    ]);
    const byline = (await ctx.http().get('/public/site/page?locale=tr&path=qr-menu-rehberi&kind=POST').expect(200))
      .body as PublicSitePageDTO;
    expect(byline).toMatchObject({ authorName: 'Ayse Yilmaz', authorIsSite: false });
  });

  it('lists posts in the sitemap and llms only while the blog is on', async () => {
    await ctx
      .http()
      .post(pages())
      .set(as())
      .send(
        post({
          kind: 'PAGE',
          path: 'restoranlar-icin',
          title: 'Restoranlar için',
          blocks: [{ type: 'text', body: 'x' }],
        }),
      )
      .expect(201);
    const map = (await ctx.http().get('/public/site/sitemap').expect(200)).body as SitemapDTO;
    expect(map.entries.map((e) => e.path)).toEqual(
      expect.arrayContaining(['/blog', '/blog/tr/qr-menu-rehberi', '/p/tr/restoranlar-icin']),
    );
    const llms = (await ctx.http().get('/public/site/llms').expect(200)).body as LlmsDTO;
    expect(llms).toMatchObject({ siteName: 'Resget', locale: 'tr' });
    expect(llms.pages.map((p) => p.path)).toEqual(['/p/tr/restoranlar-icin']);
    expect(llms.posts.map((p) => p.path)).toEqual(['/blog/tr/qr-menu-rehberi']);
    expect(llms.districts.map((d) => d.path)).toContain('/ilce/istanbul/kadikoy');

    await switchFor('blog', null);
    const off = (await ctx.http().get('/public/site/sitemap').expect(200)).body as SitemapDTO;
    expect(off.entries.map((e) => e.path)).not.toContain('/blog');
    expect(((await ctx.http().get('/public/site/llms').expect(200)).body as LlmsDTO).posts).toEqual([]);
    await ctx.http().get('/public/site/page?locale=tr&path=qr-menu-rehberi&kind=POST').expect(404);
    await switchFor('blog', true);
  });

  it('pings when a district launches or closes and stays quiet while the page engine is off', async () => {
    const area = await ctx.prisma.serviceArea.create({
      data: { countryCode: 'TR', city: 'İstanbul', district: 'Üsküdar E2E' },
    });
    try {
      const before = indexNow.submitted.length;
      await ctx
        .http()
        .patch(`/admin/service-areas/${area.id}`)
        .set(bearer(adminToken))
        .send({ isLaunched: true })
        .expect(200);
      expect(await nextPing(before)).toEqual(['http://localhost:3000/ilce/istanbul/uskudar-e2e']);

      await switchFor('page_engine', null);
      const quiet = indexNow.submitted.length;
      await ctx
        .http()
        .patch(`/admin/service-areas/${area.id}`)
        .set(bearer(adminToken))
        .send({ isLaunched: false })
        .expect(200);
      await new Promise((r) => setTimeout(r, 200));
      expect(indexNow.submitted.length).toBe(quiet);
      await ctx.http().get('/public/site/llms').expect(404);
      await switchFor('page_engine', true);
    } finally {
      await ctx.prisma.serviceArea.delete({ where: { id: area.id } });
    }
  });

  it('pings the removed address when a published post is deleted', async () => {
    const list = (await ctx.http().get(pages()).set(as()).expect(200)).body as SitePageDTO[];
    const target = list.find((p) => p.kind === 'POST')!;
    const before = indexNow.submitted.length;
    await ctx.http().delete(`${pages()}/${target.id}`).set(as()).expect(204);
    expect(await nextPing(before)).toEqual([
      'http://localhost:3000/blog/tr/qr-menu-rehberi',
      'http://localhost:3000/blog',
    ]);
    for (const p of list.filter((x) => x.id !== target.id))
      await ctx.http().delete(`${pages()}/${p.id}`).set(as()).expect(204);
  });
});
