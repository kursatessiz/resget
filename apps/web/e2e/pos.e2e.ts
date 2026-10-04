import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so automatic acceptance never touches the demo orders. */
const OWNER_PHONE = '05320000011';

test.describe('POS integration', () => {
  test('the owner connects the test POS with automatic acceptance and removes it again', async ({ page, browser }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Kasa');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Kasa ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 16', city: 'Istanbul', district: 'Kadikoy' },
      },
    });

    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/pos_integration`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/entegrasyon`);
    const pos = page.getByRole('region', { name: 'POS entegrasyonu' });
    await expect(pos.getByLabel('POS sistemi').locator('option[value="ROBOTPOS"]')).toHaveText('robotPOS (yakında)');
    await pos.getByLabel('Mağaza kodu').fill('S1');
    await pos.getByLabel('İmza anahtarı').fill('pw-secret');
    await pos.getByLabel("POS'a ulaşan siparişi otomatik kabul et").check();
    await pos.getByRole('button', { name: 'Bağla' }).click();
    await expect(pos.getByText('Bağlı: Test POS S1')).toBeVisible();
    await expect(pos.locator('[data-pos-webhook]')).toContainText('/webhooks/pos/');

    await pos.getByRole('button', { name: 'Bağlantıyı kaldır' }).click();
    await expect(pos.getByText('Bağlı: Test POS S1')).toHaveCount(0);
  });
});
