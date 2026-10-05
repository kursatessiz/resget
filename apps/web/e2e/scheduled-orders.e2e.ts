import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its switches touch no other test. */
const OWNER_PHONE = '05320000026';

test.describe('Scheduled orders', () => {
  test('the owner turns slots on and a customer pre-orders for a later time', async ({ page, browser }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Planli');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Planli ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 32', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const category = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/categories`, {
      method: 'POST',
      data: { name: 'Ana yemekler' },
    });
    await bff(page.request, `restaurants/${restaurant.id}/menu/items`, {
      method: 'POST',
      data: { categoryId: category.id, name: 'Mercimek corbasi', priceMinor: 9000, vatRateBps: 1000 },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    await bff((await admin.newPage()).request, `admin/restaurants/${restaurant.id}/features/scheduled_orders`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/ayarlar`);
    const settings = page.getByRole('region', { name: 'İleri tarihli sipariş' });
    await settings.getByLabel('İleri tarihli sipariş al').check();
    await settings.getByRole('button', { name: 'Kaydet' }).click();
    await expect(settings.getByRole('status')).toHaveText('İleri tarihli sipariş ayarları kaydedildi.');

    await page.goto(`/${restaurant.slug}`);
    await page.getByRole('button', { name: 'Ekle: Mercimek corbasi' }).click();
    await page.getByLabel('Gel al').check();
    const when = page.locator('[data-scheduling]');
    await expect(when.getByLabel('En kısa sürede')).toBeChecked();
    await when.getByLabel('İleri bir saat seç').check();
    const slot = when.locator('select');
    const firstSlot = await slot.locator('option').nth(1).getAttribute('value');
    expect(firstSlot).toBeTruthy();
    await slot.selectOption(firstSlot ?? '');
    await page.getByLabel('Adınız').fill('PW Planli Musteri');
    await page.getByLabel('Telefon numaranız').fill('05329990941');
    await page.getByLabel('Kapıda nakit').check();
    await page.getByRole('button', { name: 'Siparişi ver' }).click();
    await page.waitForURL(/\/t\//, { timeout: 20_000 });
    await expect(page.locator('[data-scheduled-for]')).toContainText('Planlanan saat');

    await page.goto(`/panel/${restaurant.slug}/siparisler`);
    await expect(page.locator('[data-scheduled-for]').first()).toContainText('İleri tarihli');
  });
});
