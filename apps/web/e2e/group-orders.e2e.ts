import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its switch touches no other test. */
const OWNER_PHONE = '05320000033';

test.describe('Group orders', () => {
  test('two friends fill one basket and the host places the order', async ({ page, browser }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Grup');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Grup ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 41', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const category = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/categories`, {
      method: 'POST',
      data: { name: 'Burgerler' },
    });
    for (const [name, priceMinor] of [
      ['Klasik burger', 22000],
      ['Patates', 8000],
    ] as const) {
      await bff(page.request, `restaurants/${restaurant.id}/menu/items`, {
        method: 'POST',
        data: { categoryId: category.id, name, priceMinor, vatRateBps: 1000 },
      });
    }
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    await bff((await admin.newPage()).request, `admin/restaurants/${restaurant.id}/features/group_orders`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    // The host starts the basket from the restaurant page in a fresh browser.
    const hostContext = await browser.newContext({ locale: 'tr-TR' });
    const host = await hostContext.newPage();
    await host.goto(`/${restaurant.slug}`);
    const start = host.getByRole('region', { name: 'Grup siparişi' });
    await start.getByRole('button', { name: 'Grup siparişi başlat' }).click();
    await start.getByLabel('Adınız').fill('Ayse');
    await start.getByRole('button', { name: 'Grup siparişi başlat' }).click();
    await host.waitForURL(/\/grup\//);
    const link = host.url();
    await host.getByRole('button', { name: 'Ekle: Klasik burger' }).click();
    await expect(host.locator('[data-participant="Ayse"]')).toContainText('1 x Klasik burger', { timeout: 10_000 });

    // A friend opens the link and joins with a name.
    const guestContext = await browser.newContext({ locale: 'tr-TR' });
    const guest = await guestContext.newPage();
    await guest.goto(link);
    await guest.getByLabel('Adınız').fill('Mehmet');
    await guest.getByRole('button', { name: 'Katıl' }).click();
    await guest.getByRole('button', { name: 'Ekle: Patates' }).click();
    await expect(guest.locator('[data-participant="Mehmet"]')).toContainText('1 x Patates', { timeout: 10_000 });
    await expect(guest.getByText('Siparişi Ayse tamamlayacak ve ödeyecek.')).toBeVisible();
    await expect(guest.getByRole('form', { name: 'Siparişi ver' })).toHaveCount(0);

    // The host sees both, closes the basket and pays for everyone.
    await expect(host.locator('[data-participant="Mehmet"]')).toContainText('1 x Patates', { timeout: 10_000 });
    await host.getByRole('button', { name: 'Sepeti kapat' }).click();
    await host.getByLabel('Gel al').check();
    await host.getByLabel('Adınız').last().fill('Ayse Yilmaz');
    await host.getByLabel('Telefon numaranız').fill('05329990943');
    await host.getByLabel('Kapıda nakit').check();
    await host.getByRole('button', { name: 'Siparişi ver' }).click();
    await host.waitForURL(/\/t\//, { timeout: 20_000 });

    await expect(guest.getByText('Grup siparişi verildi. Takip bağlantısı sepet sahibinde.')).toBeVisible({
      timeout: 10_000,
    });
    await hostContext.close();
    await guestContext.close();

    await page.goto(`/panel/${restaurant.slug}/siparisler`);
    await expect(page.getByText('Ayse Yilmaz').first()).toBeVisible();
  });
});
