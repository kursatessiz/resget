import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so the zone never changes the demo restaurant. */
const OWNER_PHONE = '05320000010';

test.describe('Delivery zone', () => {
  test('the owner sets a radius, a minimum basket and a distance band once the module is on', async ({
    page,
    browser,
  }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Bolge');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Bolge ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 14', city: 'Istanbul', district: 'Kadikoy' },
      },
    });

    // Off by default: the settings page has no zone card.
    await page.goto(`/panel/${restaurant.slug}/ayarlar`);
    await expect(page.getByRole('region', { name: 'Çalışma saatleri' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Teslimat bölgesi' })).toHaveCount(0);

    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/delivery_zones`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    // The panel reads the module list on every page load, so the card appears at once.
    await page.goto(`/panel/${restaurant.slug}/ayarlar`);
    const zone = page.getByRole('region', { name: 'Teslimat bölgesi' });
    await expect(zone).toBeVisible();
    await zone.getByLabel('Teslimat yarıçapı (km)').fill('3');
    await zone.getByLabel(/En az sepet tutarı/).fill('200');
    await zone.getByRole('button', { name: 'Bant ekle' }).click();
    await zone.locator('[data-zone-band="0"]').getByLabel(/Ücret/).fill('25');
    await zone.getByRole('button', { name: 'Bölgeyi kaydet' }).click();
    await expect(zone.getByRole('status')).toHaveText('Teslimat bölgesi kaydedildi.');

    await page.reload();
    const reloaded = page.getByRole('region', { name: 'Teslimat bölgesi' });
    await expect(reloaded.getByLabel('Teslimat yarıçapı (km)')).toHaveValue('3');
    await expect(reloaded.locator('[data-zone-band="0"]').getByLabel('Şu mesafeye kadar (km)')).toHaveValue('3');
  });
});
