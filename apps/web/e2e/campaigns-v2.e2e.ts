import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant (PRO trial) for its own campaigns. */
const OWNER_PHONE = '05320000017';

test.describe('Campaigns v2', () => {
  test('the owner drafts an A/B campaign sent at each recipient best hour and an email campaign', async ({
    page,
    browser,
  }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Kampanya');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const suffix = Date.now().toString(36);
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Kampanya ${suffix}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 22', city: 'Istanbul', district: 'Kadikoy' },
      },
    });

    // Off by default: the form has no A/B or send time fields.
    await page.goto(`/panel/${restaurant.slug}/kampanyalar`);
    await expect(page.getByLabel('Kampanya adı')).toBeVisible();
    await expect(page.getByText('A/B testi: ikinci bir metin dene')).toHaveCount(0);

    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    for (const key of ['campaigns_v2', 'email_channel']) {
      await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/${key}`, {
        method: 'PUT',
        data: { enabled: true },
      });
    }
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/kampanyalar`);
    await page.getByLabel('Kampanya adı').fill('PW AB');
    await page.getByRole('textbox', { name: /^Mesaj/ }).fill('Bu aksam tatli ikram bizden.');
    await page.getByText('A/B testi: ikinci bir metin dene').click();
    await page.getByRole('textbox', { name: 'B metni' }).fill('Bu aksam icecek bizden.');
    await page.getByLabel('B metnini alacak kitle payı (yüzde)').fill('30');
    await page.getByLabel('Gönderim saati').selectOption('BEST_HOUR');
    await page.getByLabel('Dönüşüm penceresi (gün)').fill('5');
    await page.getByRole('button', { name: 'Taslağı kaydet' }).click();
    await expect(page.getByText('Kampanya kaydedildi.')).toBeVisible();
    const preview = page.getByRole('region', { name: 'Gönderim önizlemesi' });
    await expect(preview).toContainText('B metni örneği');
    await expect(preview).toContainText('Bu aksam icecek bizden.');
    await expect(page.getByRole('listitem', { name: 'PW AB' })).toContainText('Taslak');

    // Email: a subject field, no credits.
    await page.getByLabel('Kanal').selectOption('EMAIL');
    await page.getByLabel('Kampanya adı').fill('PW Posta');
    await page.getByRole('textbox', { name: 'Konu', exact: true }).fill('Hafta sonu bize gelin');
    await page.getByRole('textbox', { name: /^Mesaj/ }).fill('Merhaba, hafta sonu tum tatlilar indirimli.');
    await page.getByRole('button', { name: 'Taslağı kaydet' }).click();
    await expect(page.getByText('Kampanya kaydedildi.')).toBeVisible();
    await expect(preview).toContainText('Gereken kredi: 0');
    await expect(preview).toContainText('Hafta sonu bize gelin');
  });

  test('the unsubscribe address answers a one-click POST and sends a browser to the opt-out page', async ({
    request,
  }) => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    const post = await request.post(`/api/iptal/${unknown}`);
    expect(post.status()).toBe(404);
    const get = await request.get(`/api/iptal/${unknown}`, { maxRedirects: 0 });
    expect(get.status()).toBe(303);
    expect(get.headers()['location']).toContain(`/iptal/${unknown}`);
    expect((await request.post('/api/iptal/not-a-token')).status()).toBe(404);
  });
});
