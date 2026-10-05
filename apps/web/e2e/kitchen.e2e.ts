import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its switch touches no other test. */
const OWNER_PHONE = '05320000030';

test.describe('Kitchen display', () => {
  test('the owner names a station and the kitchen works a ticket to ready', async ({ page, browser }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Mutfak');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Mutfak ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 38', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const category = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/categories`, {
      method: 'POST',
      data: { name: 'Izgaralar' },
    });
    const item = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/items`, {
      method: 'POST',
      data: { categoryId: category.id, name: 'Adana kebap', priceMinor: 25000, vatRateBps: 1000 },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    await bff((await admin.newPage()).request, `admin/restaurants/${restaurant.id}/features/kitchen_display`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    // The section's station is set on the menu screen.
    await page.goto(`/panel/${restaurant.slug}/menu`);
    const section = page.getByRole('region', { name: 'Izgaralar' });
    await section.getByRole('button', { name: 'Mutfak istasyonu' }).click();
    const form = section.getByRole('form', { name: 'Mutfak istasyonu' });
    await form.getByLabel('İstasyon adı').fill('Izgara');
    await form.getByRole('button', { name: 'Kaydet' }).click();
    await expect(section).toContainText('İstasyon: Izgara');

    const details = await bff<{ branches: { id: string }[] }>(page.request, `restaurants/${restaurant.id}`);
    const order = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/orders`, {
      method: 'POST',
      data: {
        branchId: details.branches[0].id,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: item.id, quantity: 2 }],
        note: 'Acili olsun',
      },
    });
    await bff(page.request, `restaurants/${restaurant.id}/orders/${order.id}/transition`, {
      method: 'POST',
      data: { to: 'ACCEPTED', prepMinutes: 15 },
    });

    await page.goto(`/panel/${restaurant.slug}/mutfak`);
    await expect(page.getByRole('heading', { name: 'Mutfak ekranı' })).toBeVisible();
    await page.getByLabel('İstasyon').selectOption('Izgara');
    const ticket = page.locator(`[data-ticket="${order.id}"]`);
    await expect(ticket).toContainText('2 x Adana kebap');
    await expect(ticket).toContainText('Not: Acili olsun');
    await ticket.getByRole('button', { name: 'Hazır olarak işaretle: Adana kebap' }).click();
    await expect(ticket.locator('[data-progress]')).toHaveAttribute('data-progress', '1/1');
    await ticket.getByRole('button', { name: 'Hazır', exact: true }).click();
    await expect(ticket).toHaveCount(0);
    await expect(page.getByText('Mutfakta bekleyen sipariş yok.')).toBeVisible();
  });
});
