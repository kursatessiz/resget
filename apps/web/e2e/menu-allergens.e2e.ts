import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its switch touches no other test. */
const OWNER_PHONE = '05320000027';

test.describe('Menu allergens', () => {
  test('the owner declares allergens and a guest hides items that contain them', async ({ page, browser }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Alerjen');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Alerjen ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 34', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const category = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/categories`, {
      method: 'POST',
      data: { name: 'Tatlilar' },
    });
    await bff(page.request, `restaurants/${restaurant.id}/menu/items`, {
      method: 'POST',
      data: { categoryId: category.id, name: 'Sutlac', priceMinor: 8000, vatRateBps: 1000 },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    await bff((await admin.newPage()).request, `admin/restaurants/${restaurant.id}/features/allergens`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/menu`);
    await page.getByRole('button', { name: 'Ürünü düzenle' }).click();
    const form = page.locator('form', { has: page.getByLabel('Süt', { exact: true }) });
    await form.getByLabel('Süt', { exact: true }).check();
    await form.getByLabel('Vegan', { exact: true }).check();
    await expect(form.locator('[data-allergen-conflict]')).toContainText('Vegan');
    await form.getByLabel('Vegan', { exact: true }).uncheck();
    await form.getByLabel('Vejetaryen', { exact: true }).check();
    await expect(form.locator('[data-allergen-conflict]')).toHaveCount(0);
    await form.getByRole('button', { name: 'Kaydet' }).first().click();
    await expect(page.getByRole('button', { name: 'Ürünü düzenle' })).toBeVisible();

    await page.goto(`/${restaurant.slug}`);
    const item = page.locator('[data-menu-item="Sutlac"]');
    await expect(item.locator('[data-allergens]')).toHaveText('İçerir: Süt');
    await expect(item.locator('[data-dietary-tags]')).toContainText('Vejetaryen');
    const filter = page.locator('[data-allergen-filter]');
    await expect(filter).toContainText('Alerjen ve içerik bilgisi işletme tarafından verilir.');
    await filter.getByLabel('Süt', { exact: true }).check();
    await expect(page.locator('[data-menu-item="Sutlac"]')).toHaveCount(0);
    await expect(page.getByText('Bu bölümdeki ürünlerin hepsi seçtiğiniz alerjenleri içeriyor.')).toBeVisible();
  });
});
