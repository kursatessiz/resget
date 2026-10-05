import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its switches touch no other test. */
const OWNER_PHONE = '05320000024';
/** The API's test-only app secret (playwright.config.ts). */
const META_APP_SECRET = 'pw-meta-app-secret';
const API_URL = 'http://localhost:4000';

test.describe('Lead Ads', () => {
  test('the owner turns on lead import for a page and a signed lead shows up as a contact', async ({
    page,
    browser,
  }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Aday');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Aday ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 24', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const adminPage = await admin.newPage();
    for (const key of ['integration_hub', 'lead_ads']) {
      await bff(adminPage.request, `admin/restaurants/${restaurant.id}/features/${key}`, {
        method: 'PUT',
        data: { enabled: true },
      });
    }
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/entegrasyon`);
    const card = page.getByRole('region', { name: 'Sosyal hesaplar' });
    await card.getByRole('button', { name: 'Meta ile bağlan' }).click();
    await page.waitForURL(new RegExp(`/panel/${restaurant.slug}/entegrasyon\\?meta=connected$`));
    const fbPage = card.locator('[data-social-account="mock-page-1"]');
    await expect(fbPage.getByLabel('Adayları al')).toBeDisabled();
    await fbPage.getByLabel('Kullanılsın').check();
    await expect(fbPage.getByLabel('Adayları al')).toBeEnabled();
    await fbPage.getByLabel('Adayları al').check();
    await expect(fbPage.getByLabel('Adayları al')).toBeChecked();
    await expect(card.locator('[data-social-account="mock-ig-1"]').getByLabel('Adayları al')).toHaveCount(0);

    const leads = page.getByRole('region', { name: 'Lead Ads adayları' });
    await expect(leads).toContainText('Henüz aday gelmedi.');

    // MOCK answers leadgen ids 900000-900999 with a full form.
    const n = Math.floor(Math.random() * 1000);
    const leadgenId = String(900_000 + n);
    const body = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: 'mock-page-1',
          changes: [{ field: 'leadgen', value: { leadgen_id: leadgenId, page_id: 'mock-page-1' } }],
        },
      ],
    });
    const signature = `sha256=${createHmac('sha256', META_APP_SECRET).update(body).digest('hex')}`;
    const res = await page.request.post(`${API_URL}/webhooks/meta`, {
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
      data: body,
    });
    expect(res.status()).toBe(200);

    await leads.getByRole('button', { name: 'Yenile' }).click();
    const row = leads.locator(`[data-lead="${leadgenId}"]`);
    await expect(row).toContainText(`Aday ${String(n).padStart(4, '0')}`);
    await expect(row).toContainText('Aktarıldı');
    await expect(row).toContainText('Deneme Sayfasi');
  });
});
