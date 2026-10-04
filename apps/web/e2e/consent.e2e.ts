import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its consent settings stay its own. */
const OWNER_PHONE = '05320000014';

test.describe('Consent v2', () => {
  test('the owner sets sending limits, and a confirmation link confirms only on the button', async ({
    page,
    browser,
  }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Riza');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Riza ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 16', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/consent_v2`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/kampanyalar`);
    const limits = page.getByRole('region', { name: 'Gönderim sınırları' });
    await expect(limits.getByLabel('Günlük en fazla')).toHaveValue('1');
    await limits.getByLabel('Haftalık en fazla').fill('5');
    await limits.getByRole('button', { name: 'Kaydet' }).click();
    await expect(limits.getByRole('status')).toHaveText('Sınırlar kaydedildi.');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Gönderim sınırları' }).getByLabel('Haftalık en fazla')).toHaveValue(
      '5',
    );

    // Opening the page changes nothing; an unknown link says so only after the button.
    await page.goto(`/onay/${'a'.repeat(43)}`);
    await expect(page.getByRole('heading', { name: 'İzninizi onaylayın' })).toBeVisible();
    await page.getByRole('button', { name: 'Onaylıyorum' }).click();
    await expect(page.getByRole('status')).toHaveText('Bu bağlantı geçerli değil veya süresi dolmuş.');
  });
});
