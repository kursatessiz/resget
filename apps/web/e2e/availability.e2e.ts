import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so a pause never blocks the other order scenarios. */
const OWNER_PHONE = '05320000009';

test.describe('Order availability', () => {
  test('the owner pauses orders, the menu page says so, and opening hours are edited', async ({ page, browser }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Durum');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Durum ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 12', city: 'Istanbul', district: 'Kadikoy' },
      },
    });

    // The module ships off; the platform owner opens it for this restaurant only.
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/order_availability`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/siparisler`);
    const bar = page.getByRole('region', { name: 'Sipariş alma' });
    await expect(bar.locator('[data-availability-state]')).toHaveText('Sipariş alınıyor');
    await bar.getByRole('button', { name: '30 dk', exact: true }).click();
    await expect(bar.locator('[data-availability-state]')).toHaveText('Duraklatıldı');

    await page.goto(`/${restaurant.slug}`);
    await expect(page.locator('[data-availability="PAUSED"]')).toContainText('sipariş almıyor');

    await page.goto(`/panel/${restaurant.slug}/siparisler`);
    await bar.getByRole('button', { name: 'Siparişleri aç' }).click();
    await expect(bar.locator('[data-availability-state]')).toHaveText('Sipariş alınıyor');
    await bar.getByRole('button', { name: '+20 dk', exact: true }).click();
    await expect(bar).toContainText('20 dk ekleniyor');

    await page.goto(`/panel/${restaurant.slug}/ayarlar`);
    const hours = page.getByRole('region', { name: 'Çalışma saatleri' });
    const monday = hours.locator('[data-hours-day="mon"]');
    await monday.getByRole('button', { name: 'Aralık ekle' }).click();
    await monday.getByLabel('Kapanış').fill('23:30');
    await hours.getByRole('button', { name: 'Saatleri kaydet' }).click();
    await expect(hours.getByRole('status')).toHaveText('Çalışma saatleri kaydedildi.');
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Çalışma saatleri' }).locator('[data-hours-day="mon"]').getByLabel('Kapanış'),
    ).toHaveValue('23:30');
  });
});
