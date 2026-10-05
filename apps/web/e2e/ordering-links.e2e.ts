import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its switch touches no other test. */
const OWNER_PHONE = '05320000029';

test.describe('Ordering links', () => {
  test('a guest orders through the Instagram link and the owner sees the channel', async ({ page, browser }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Kanal');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Kanal ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 37', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const category = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/categories`, {
      method: 'POST',
      data: { name: 'Corbalar' },
    });
    await bff(page.request, `restaurants/${restaurant.id}/menu/items`, {
      method: 'POST',
      data: { categoryId: category.id, name: 'Ezogelin corbasi', priceMinor: 9000, vatRateBps: 1000 },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    await bff((await admin.newPage()).request, `admin/restaurants/${restaurant.id}/features/ordering_links`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/siparis-baglantilari`);
    await expect(page.getByRole('heading', { name: 'Sipariş bağlantıları' })).toBeVisible();
    const instagram = page.locator('[data-source="INSTAGRAM"]');
    const link = await instagram.getByLabel('Instagram bağlantısı').inputValue();
    expect(new URL(link).searchParams.get('via')).toBe('instagram');
    await expect(instagram.locator('[data-orders]')).toHaveAttribute('data-orders', '0');

    // The guest opens the link on another device: no session, just the page.
    const guest = await browser.newContext({ locale: 'tr-TR' });
    const guestPage = await guest.newPage();
    await guestPage.goto(new URL(link).pathname + new URL(link).search);
    await guestPage.getByRole('button', { name: 'Ekle: Ezogelin corbasi' }).click();
    await guestPage.getByLabel('Gel al').check();
    await guestPage.getByLabel('Adınız').fill('PW Kanal Musteri');
    await guestPage.getByLabel('Telefon numaranız').fill('05329990942');
    await guestPage.getByLabel('Kapıda nakit').check();
    await guestPage.getByRole('button', { name: 'Siparişi ver' }).click();
    await guestPage.waitForURL(/\/t\//, { timeout: 20_000 });
    await guest.close();

    await page.goto(`/panel/${restaurant.slug}/siparisler`);
    await expect(page.locator('[data-order-source="INSTAGRAM"]').first()).toContainText('Instagram bağlantısından');
    await page.goto(`/panel/${restaurant.slug}/siparis-baglantilari`);
    await expect(page.locator('[data-source="INSTAGRAM"] [data-orders]')).toHaveAttribute('data-orders', '1');
  });
});
