import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its switch touches no other test. */
const OWNER_PHONE = '05320000032';

test.describe('Menu stock', () => {
  test('the owner counts portions and guests see the last ones', async ({ page, browser }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Stok');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Stok ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 40', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const category = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/categories`, {
      method: 'POST',
      data: { name: 'Gunun yemekleri' },
    });
    await bff(page.request, `restaurants/${restaurant.id}/menu/items`, {
      method: 'POST',
      data: { categoryId: category.id, name: 'Kuru fasulye', priceMinor: 14000, vatRateBps: 1000 },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    await bff((await admin.newPage()).request, `admin/restaurants/${restaurant.id}/features/menu_stock`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/menu`);
    await page.getByRole('button', { name: 'Ürünü düzenle' }).click();
    await page.getByLabel('Stok (porsiyon)').fill('2');
    await page.getByRole('button', { name: 'Kaydet' }).first().click();
    await expect(page.locator('[data-stock="2"]')).toHaveText('Stok: 2');

    await page.goto(`/${restaurant.slug}`);
    await expect(page.locator('[data-stock-left="2"]')).toHaveText('Son 2 porsiyon');
  });
});
