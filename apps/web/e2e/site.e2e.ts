import { test, expect } from '@playwright/test';
import type { PlatformAdminDTO, SitePageDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const PATH = `pw-sayfa-${Date.now().toString(36)}`;
const POST = `pw-yazi-${Date.now().toString(36)}`;

test.describe('Page engine and SEO', () => {
  test.use({ storageState: ADMIN_STATE });

  test('platform marketing publishes a block page; robots, sitemap, district and restaurant pages carry SEO data', async ({
    page,
  }) => {
    let platform = await bff<PlatformAdminDTO>(page.request, 'admin/platform');
    if (!platform.tenant) {
      platform = await bff<PlatformAdminDTO>(page.request, 'admin/platform/setup', {
        method: 'POST',
        data: {
          name: 'Platform',
          countryCode: 'TR',
          currency: 'TRY',
          timezone: 'Europe/Istanbul',
          defaultLocale: 'tr',
        },
      });
    }
    const platformId = platform.tenant!.id;
    // The platform tenant's own override, so parallel scenarios switching the global flag do not interfere.
    await bff(page.request, `admin/restaurants/${platformId}/features/marketing_platform`, {
      method: 'PUT',
      data: { enabled: true },
    });
    try {
      // Off by default: no screen, no public page, an empty sitemap; robots.txt is always served.
      expect((await page.goto('/pazarlama/sayfalar'))?.status()).toBe(404);
      const robots = await (await page.request.get('/robots.txt')).text();
      expect(robots).toContain('Disallow: /panel');
      expect(robots).toContain('Disallow: /pazarlama');
      expect(robots).toContain('Sitemap: ');
      expect(await (await page.request.get('/sitemap.xml')).text()).not.toContain('<loc>');

      await bff(page.request, `admin/restaurants/${platformId}/features/page_engine`, {
        method: 'PUT',
        data: { enabled: true },
      });
      await page.goto('/pazarlama');
      await page.getByRole('complementary').getByRole('link', { name: 'Sayfalar' }).click();
      await expect(page).toHaveURL(/\/pazarlama\/sayfalar$/);
      await page.getByRole('button', { name: 'Yeni sayfa' }).click();
      await page.getByRole('textbox', { name: /^Adres/ }).fill(PATH);
      await page.getByRole('textbox', { name: /^Arama sonucu başlığı/ }).fill('Restoranlar için yüzde bir komisyon');
      await page
        .getByRole('textbox', { name: /^Arama sonucu açıklaması/ })
        .fill('Masa QR, kendi sipariş sayfanız ve pazaryeri; sipariş başına yüzde bir komisyon.');
      const hero = page.getByRole('group', { name: '1. blok: Giriş bandı' });
      await hero.getByRole('textbox', { name: 'Başlık', exact: true }).fill('Siparişleriniz sizin');
      await page.getByRole('button', { name: 'Blok ekle: Sık sorulan sorular' }).click();
      const faq = page.getByRole('group', { name: '2. blok: Sık sorulan sorular' });
      await faq.getByRole('textbox', { name: 'Soru' }).fill('Komisyon ne kadar?');
      await faq.getByRole('textbox', { name: 'Yanıt' }).fill('Sipariş başına yüzde bir.');
      await page.getByLabel('Durum').selectOption('PUBLISHED');
      await page.getByRole('button', { name: 'Kaydet' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Sayfa kaydedildi.' })).toBeVisible();

      await page.goto(`/p/tr/${PATH}`);
      await expect(page.getByRole('heading', { name: 'Siparişleriniz sizin', level: 1 })).toBeVisible();
      await expect(page).toHaveTitle('Restoranlar için yüzde bir komisyon');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/p/tr/${PATH}$`));
      await page.getByText('Komisyon ne kadar?').click();
      await expect(page.getByText('Sipariş başına yüzde bir.')).toBeVisible();
      const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(ld.some((s) => s.includes('"FAQPage"'))).toBe(true);
      expect(ld.some((s) => s.includes('"BreadcrumbList"'))).toBe(true);

      const sitemap = await (await page.request.get('/sitemap.xml')).text();
      expect(sitemap).toContain(`/p/tr/${PATH}</loc>`);
      expect(sitemap).toContain('/ilce/istanbul/kadikoy</loc>');
      expect(sitemap).toContain('/demo-lokanta</loc>');

      await page.goto('/ilce/istanbul/kadikoy');
      await expect(page.getByRole('heading', { name: 'Kadikoy restoranları', level: 1 })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Demo Lokanta' })).toBeVisible();

      // The restaurant page always has a title and canonical address; structured data follows its own switch.
      await page.goto('/demo-lokanta');
      await expect(page).toHaveTitle('Demo Lokanta: menü ve online sipariş');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/demo-lokanta$/);
      await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
      // The blog: a post written in the pages screen opens under /blog with its byline and structured data.
      await bff(page.request, `admin/restaurants/${platformId}/features/blog`, {
        method: 'PUT',
        data: { enabled: true },
      });
      await page.goto('/pazarlama/sayfalar');
      await page.getByRole('button', { name: 'Yeni sayfa' }).click();
      await page.getByLabel('Tür').selectOption('POST');
      await page.getByRole('textbox', { name: /^Yazar/ }).fill('Ayse Yilmaz');
      await page.getByRole('textbox', { name: /^Adres/ }).fill(POST);
      await page.getByRole('textbox', { name: /^Arama sonucu başlığı/ }).fill('Masa QR menü nasıl kurulur');
      await page
        .getByRole('textbox', { name: /^Arama sonucu açıklaması/ })
        .fill('Masa QR menüyü kurmanın adımları ve sık yapılan hatalar.');
      await page
        .getByRole('group', { name: '1. blok: Giriş bandı' })
        .getByRole('textbox', { name: 'Başlık', exact: true })
        .fill('Adım adım kurulum');
      await page.getByLabel('Durum').selectOption('PUBLISHED');
      await page.getByRole('button', { name: 'Kaydet' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Sayfa kaydedildi.' })).toBeVisible();

      await page.goto('/blog');
      await expect(page.getByRole('heading', { name: 'Blog', level: 1 })).toBeVisible();
      await page.getByRole('link', { name: 'Masa QR menü nasıl kurulur', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/blog/tr/${POST}$`));
      await expect(page.getByRole('heading', { name: 'Masa QR menü nasıl kurulur', level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Adım adım kurulum', level: 2 })).toBeVisible();
      await expect(page.getByText(/^Ayse Yilmaz, /)).toBeVisible();
      const postLd = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(postLd.some((s) => s.includes('"BlogPosting"') && s.includes('"Person"'))).toBe(true);

      // llms.txt lists the published page and the post; the IndexNow key file answers only for the configured key.
      const llms = await (await page.request.get('/llms.txt')).text();
      expect(llms).toContain(`/p/tr/${PATH})`);
      expect(llms).toContain(`/blog/tr/${POST})`);
      expect(llms).toContain('/ilce/istanbul/kadikoy)');
      expect((await page.request.get('/indexnow/bilinmeyen-anahtar-1234.txt')).status()).toBe(404);

      // A table QR page points its canonical address at the restaurant page.
      await page.goto('/m/demo-masa-1-sabit-token-0001');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/demo-lokanta$/);
      expect(robots).not.toContain('Disallow: /m/');
    } finally {
      const pages = await bff<SitePageDTO[]>(page.request, `restaurants/${platformId}/site/pages`).catch(() => []);
      for (const p of pages.filter((x) => x.path === PATH || x.path === POST)) {
        await page.request.delete(`/api/bff/restaurants/${platformId}/site/pages/${p.id}`);
      }
      for (const key of ['page_engine', 'blog']) {
        await bff(page.request, `admin/restaurants/${platformId}/features/${key}`, {
          method: 'PUT',
          data: { enabled: null },
        });
      }
      await bff(page.request, `admin/restaurants/${platformId}/features/marketing_platform`, {
        method: 'PUT',
        data: { enabled: null },
      });
    }
  });
});
