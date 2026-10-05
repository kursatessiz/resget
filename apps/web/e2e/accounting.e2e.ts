import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its switch touches no other test. */
const OWNER_PHONE = '05320000031';

test.describe('Accounting export', () => {
  test('the owner downloads a month of orders for the accountant', async ({ page, browser }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Muhasebe');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Muhasebe ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 39', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const category = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/categories`, {
      method: 'POST',
      data: { name: 'Pideler' },
    });
    const item = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/items`, {
      method: 'POST',
      data: { categoryId: category.id, name: 'Kasarli pide', priceMinor: 18000, vatRateBps: 1000 },
    });
    const details = await bff<{ branches: { id: string }[] }>(page.request, `restaurants/${restaurant.id}`);
    await bff(page.request, `restaurants/${restaurant.id}/orders`, {
      method: 'POST',
      data: {
        branchId: details.branches[0].id,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: item.id, quantity: 2 }],
      },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    await bff((await admin.newPage()).request, `admin/restaurants/${restaurant.id}/features/accounting_export`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/finans`);
    const card = page.getByRole('region', { name: 'Muhasebe dökümü' });
    const now = new Date();
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    await card.getByLabel('Ay').fill(thisMonth);
    const href = await card.getByRole('link', { name: 'Siparişler (CSV)' }).getAttribute('href');
    expect(href).toContain(`month=${now.getUTCMonth() + 1}`);
    const res = await page.request.get(href ?? '');
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-disposition']).toContain('resget-orders-');
    const text = await res.text();
    expect(text).toContain('chargedToCustomer');
    expect(text).toContain('360.00');
    const lines = await page.request.get(
      (await card.getByRole('link', { name: 'Sipariş kalemleri ve KDV oranları (CSV)' }).getAttribute('href')) ?? '',
    );
    expect(await lines.text()).toContain('Kasarli pide');
  });
});
