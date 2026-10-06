import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant and links its own wallet. */
const PHONE = '05320000039';

test.describe('Platform wallets', () => {
  test('the customer links Masterpass in the account and pays an order with it', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Cuzdan');
    await page.getByLabel('Telefon numarası').fill(PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Cuzdan ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 90', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const base = `restaurants/${restaurant.id}`;
    const category = await bff<{ id: string }>(page.request, `${base}/menu/categories`, {
      method: 'POST',
      data: { name: 'Tatlilar' },
    });
    await bff(page.request, `${base}/menu/items`, {
      method: 'POST',
      data: { categoryId: category.id, name: 'Kunefe', priceMinor: 18000, vatRateBps: 1000 },
    });
    // Wallet charges run at the platform's merchant, so only a platform-collected restaurant takes them.
    await bff(page.request, `${base}/payments/mode`, { method: 'PUT', data: { paymentMode: 'PLATFORM_PSP' } });

    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    await bff(consolePage.request, 'admin/features/platform_wallets', { method: 'PUT', data: { enabled: true } });

    try {
      // The same person, now as a customer, links Masterpass from the account page.
      await page.goto('/hesabim');
      const wallets = page.getByRole('region', { name: 'Cüzdanlarım' });
      await expect(wallets).toContainText('Henüz bağlı cüzdan kartınız yok.');
      await wallets.getByRole('button', { name: 'Masterpass bağla' }).click();
      await page.waitForURL(/\/hesabim\?cuzdan=eklendi/, { timeout: 15_000 });
      await expect(wallets.getByRole('status')).toHaveText('Kartlarınız eklendi.');
      await expect(wallets).toContainText('Masterpass: Mastercard •••• 4242');

      // The ordering page offers the card and the order is placed without a payment page.
      await page.goto(`/${restaurant.slug}`);
      await page.locator('[data-menu-item="Kunefe"]').getByRole('button', { name: 'Ekle: Kunefe' }).click();
      await page.getByLabel('Gel al').check();
      await page.getByLabel('Masterpass ile öde: Mastercard •••• 4242').check();
      await page.getByRole('button', { name: 'Siparişi ver' }).click();
      await page.waitForURL(/\/t\//, { timeout: 20_000 });
      await expect(page.getByText('Siparişiniz işletmeye iletildi, onay bekleniyor.')).toBeVisible();
    } finally {
      await bff(consolePage.request, 'admin/features/platform_wallets', { method: 'PUT', data: { enabled: null } });
      await admin.close();
    }
  });
});
