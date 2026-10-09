import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { OrderDetailDTO, RestaurantCreatedDTO, RestaurantSettingsDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
const API_URL = 'http://localhost:4000';
/** Not seeded: this scenario opens its own restaurant so its money touches no other test. */
const OWNER_PHONE = '05320000037';

test.describe('Payout schedules', () => {
  test('the console prices faster payouts, the owner picks daily and takes the balance instantly', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Hakedis');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Hakedis ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 74', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const settings = await bff<RestaurantSettingsDTO>(page.request, `restaurants/${restaurant.id}`);
    const category = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/categories`, {
      method: 'POST',
      data: { name: 'Pideler' },
    });
    const item = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/items`, {
      method: 'POST',
      data: { categoryId: category.id, name: 'Kiymali pide', priceMinor: 25000, vatRateBps: 1000 },
    });
    // The platform collects for this restaurant, so a completed order writes payable lines.
    await bff(page.request, `restaurants/${restaurant.id}/payments/mode`, {
      method: 'PUT',
      data: { paymentMode: 'PLATFORM_PSP' },
    });
    const order = await bff<OrderDetailDTO>(page.request, `restaurants/${restaurant.id}/orders`, {
      method: 'POST',
      data: {
        branchId: settings.branches[0].id,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: item.id, quantity: 2 }],
        customer: { fullName: 'Hakedis Musteri', phone: `05325${String(Date.now()).slice(-6)}` },
        payment: { method: 'ONLINE_CARD' },
      },
    });
    // Paid online through the platform merchant: only money the platform collected is paid out.
    const body = JSON.stringify({
      providerRef: `pw-payout-${Date.now()}`,
      orderRef: order.id,
      status: 'CAPTURED',
      amountMinor: order.chargedToCustomerMinor,
      currency: country.currency,
      pspFeeMinor: null,
      occurredAt: new Date().toISOString(),
    });
    const notice = await page.request.post(`${API_URL}/webhooks/payments/platform/MOCK`, {
      headers: {
        'content-type': 'application/json',
        'x-mock-signature': createHmac('sha256', 'mock').update(body).digest('hex'),
      },
      data: body,
    });
    expect(notice.ok()).toBe(true);
    for (const step of [{ to: 'ACCEPTED', prepMinutes: 5 }, { to: 'READY' }, { to: 'PICKED_UP' }]) {
      await bff(page.request, `restaurants/${restaurant.id}/orders/${order.id}/transition`, {
        method: 'POST',
        data: step,
      });
    }

    // The console offers daily and instant payouts in this currency.
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/payout_schedules`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await consolePage.goto('/admin/hakedisler');
    const options = consolePage.getByRole('region', { name: 'Hakediş takvimi seçenekleri' });
    for (const [cadence, label, bps, fixed, days] of [
      ['DAILY', 'Günlük', '50', '300', '1'],
      ['INSTANT', 'Anında', '100', '500', '0'],
    ] as const) {
      await options.getByLabel('Takvim').selectOption(cadence);
      await options.getByLabel('Para birimi').fill(country.currency);
      await options.getByLabel('İş günü').fill(days);
      await options.getByLabel('Ücret oranı (baz puan)').fill(bps);
      await options.getByLabel('Sabit ücret (minör birim)').fill(fixed);
      await options.getByRole('button', { name: 'Seçeneği kaydet' }).click();
      await expect(options.locator(`[data-payout-option-row="${cadence}:${country.currency}"]`)).toContainText(label);
    }
    await admin.close();

    // The owner picks daily and takes the waiting balance instantly.
    await page.goto(`/panel/${restaurant.slug}/finans`);
    const schedule = page.getByRole('region', { name: 'Hakediş takvimi' });
    await expect(schedule.locator('[data-payout-cadence]')).toContainText('Haftalık');
    await schedule.getByLabel('Takvim').selectOption('DAILY');
    await schedule.getByRole('button', { name: 'Takvimi kaydet' }).click();
    await expect(schedule.getByRole('status')).toHaveText('Takvim kaydedildi.');
    await expect(schedule.locator('[data-payout-cadence]')).toContainText('Günlük');
    await expect(schedule.locator('[data-instant-quote]')).toContainText('Bekleyen');
    await schedule.getByRole('button', { name: 'Şimdi öde' }).click();
    await expect(schedule.getByRole('status')).toContainText('Anında hakediş planlandı');
    await expect(schedule.locator('[data-instant-payout]')).toContainText('Bekleyen hakediş yok.');

    await page.reload();
    await expect(page.getByText('Anında.').first()).toBeVisible();
    await expect(page.getByText(/Ücret: /).first()).toBeVisible();
  });
});
