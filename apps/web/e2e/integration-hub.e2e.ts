import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its switch touches no other test. */
const OWNER_PHONE = '05320000023';

test.describe('Integration hub', () => {
  test('the owner connects Meta through the consent round trip and picks an account to use', async ({
    page,
    browser,
  }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Entegrasyon');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Entegrasyon ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 24', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    await bff((await admin.newPage()).request, `admin/restaurants/${restaurant.id}/features/integration_hub`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/entegrasyon`);
    const card = page.getByRole('region', { name: 'Sosyal hesaplar' });
    await expect(card).toContainText('Henüz bağlı hesap yok.');
    await card.getByRole('button', { name: 'Meta ile bağlan' }).click();

    // MOCK sends the browser through the API callback and back to this screen.
    await page.waitForURL(new RegExp(`/panel/${restaurant.slug}/entegrasyon\\?meta=connected$`));
    await expect(card.locator('[data-social-result="connected"]')).toBeVisible();
    await expect(card.locator('[data-social-account]')).toHaveCount(2);
    const fbPage = card.locator('[data-social-account="mock-page-1"]');
    await expect(fbPage).toContainText('Facebook sayfası');
    await fbPage.getByLabel('Kullanılsın').check();
    await expect(fbPage.getByLabel('Kullanılsın')).toBeChecked();
    await page.reload();
    await expect(card.locator('[data-social-account="mock-page-1"]').getByLabel('Kullanılsın')).toBeChecked();
  });
});
