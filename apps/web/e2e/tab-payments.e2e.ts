import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES, formatMoney } from '@resget/shared';
import type { OrderDetailDTO, RestaurantCreatedDTO, RestaurantSettingsDTO, TabBillDTO, TableDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant and its own POS connection. */
const OWNER_PHONE = '05320000040';
const MERCHANT = 'pw-tabpay';

test.describe('Open tab online share', () => {
  test('a guest starts paying the rest of the tab by card from the phone', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Hesap Kart');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Hesap Kart ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 64', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const base = `restaurants/${restaurant.id}`;
    const settings = await bff<RestaurantSettingsDTO>(page.request, base);
    const category = await bff<{ id: string }>(page.request, `${base}/menu/categories`, {
      method: 'POST',
      data: { name: 'Mezeler' },
    });
    const item = await bff<{ id: string }>(page.request, `${base}/menu/items`, {
      method: 'POST',
      data: { categoryId: category.id, name: 'Humus', priceMinor: 12000, vatRateBps: 1000 },
    });
    const table = await bff<TableDTO>(page.request, `${base}/tables`, {
      method: 'POST',
      data: { branchId: settings.branches[0].id, label: 'Teras 2' },
    });
    await bff(page.request, `${base}/payments/connection`, {
      method: 'PUT',
      data: { providerCode: 'MOCK', credentials: { merchantId: MERCHANT } },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    await bff((await admin.newPage()).request, `admin/restaurants/${restaurant.id}/features/table_tabs`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();
    const order = await bff<OrderDetailDTO>(page.request, `${base}/orders`, {
      method: 'POST',
      data: {
        branchId: settings.branches[0].id,
        channel: 'TABLE_QR',
        fulfillment: 'DINE_IN',
        tableId: table.id,
        tab: true,
        items: [{ menuItemId: item.id, quantity: 2 }],
      },
    });
    const tab = await bff<TabBillDTO>(page.request, `${base}/tabs/${order.tabId}`);
    const money = (minor: number) => formatMoney({ amountMinor: minor, currency: country.currency }, 'tr');

    const guestContext = await browser.newContext({ locale: 'tr-TR' });
    const guest = await guestContext.newPage();
    await guest.goto(`/hesap/${tab.token}`);
    const pay = guest.getByRole('region', { name: 'Kartla öde' });
    await expect(pay).toBeVisible();
    // The page leaves for the POS's payment page at once, so the payment id is read on the way through.
    let paymentId = '';
    await guest.route(`**/api/bff/public/tabs/${tab.token}/pay`, async (route) => {
      const response = await route.fetch();
      paymentId = ((await response.json()) as { paymentId: string }).paymentId;
      await route.fulfill({ response });
    });
    await pay.getByRole('button', { name: `Kalanı kartla öde (${money(tab.dueMinor)})` }).click();
    await guest.waitForURL(/mockSession=/);

    expect(paymentId).not.toBe('');
    // Nothing is paid until the POS confirms the capture (docs/ACIK_HESAP.md); the API e2e covers that leg.
    await guest.goto(`/hesap/${tab.token}`);
    await expect(guest.locator('[data-bill-due]')).toHaveText(money(tab.dueMinor));
    await expect(guest.getByRole('region', { name: 'Kartla öde' })).toBeVisible();
    await guestContext.close();
  });
});
