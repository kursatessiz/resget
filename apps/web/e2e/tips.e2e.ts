import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES, tipPresets } from '@resget/shared';
import type {
  DeliveryTripDTO,
  DispatchBoardDTO,
  OrderDetailDTO,
  RestaurantCreatedDTO,
  RestaurantSettingsDTO,
} from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its money touches no other test. */
const OWNER_PHONE = '05320000038';
const API_URL = 'http://localhost:4000';

test.describe('Courier tips', () => {
  test('the customer tips the courier after delivery and the restaurant sees it per courier', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('Selim Bahsis');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Bahsis ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 81', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const base = `restaurants/${restaurant.id}`;
    const settings = await bff<RestaurantSettingsDTO>(page.request, base);
    const category = await bff<{ id: string }>(page.request, `${base}/menu/categories`, {
      method: 'POST',
      data: { name: 'Burgerler' },
    });
    const item = await bff<{ id: string }>(page.request, `${base}/menu/items`, {
      method: 'POST',
      data: { categoryId: category.id, name: 'Klasik burger', priceMinor: 32000, vatRateBps: 1000 },
    });
    // The platform's merchant collects, so no POS connection is needed for the tip.
    await bff(page.request, `${base}/payments/mode`, { method: 'PUT', data: { paymentMode: 'PLATFORM_PSP' } });
    const order = await bff<OrderDetailDTO & { trackingUrl: string }>(page.request, `${base}/orders`, {
      method: 'POST',
      data: {
        branchId: settings.branches[0].id,
        channel: 'PHONE',
        fulfillment: 'DELIVERY',
        items: [{ menuItemId: item.id, quantity: 1 }],
        address: {
          addressLine: 'Bahariye Cad. No 12',
          city: 'Istanbul',
          district: 'Kadikoy',
          contactName: 'Bahsis Musteri',
          contactPhone: '0532 999 08 08',
          point: { lat: 40.99, lng: 29.03 },
        },
        customer: { fullName: 'Bahsis Musteri', phone: `05327${String(Date.now()).slice(-6)}` },
        deliveryFeeMinor: 1500,
      },
    });
    for (const step of [{ to: 'ACCEPTED', prepMinutes: 5 }, { to: 'PREPARING' }, { to: 'READY' }]) {
      await bff(page.request, `${base}/orders/${order.id}/transition`, { method: 'POST', data: step });
    }
    // The owner drives the delivery as the restaurant's own courier.
    const board = await bff<DispatchBoardDTO>(page.request, `${base}/dispatch/board`);
    const trip = await bff<DeliveryTripDTO>(page.request, `${base}/dispatch/trips`, {
      method: 'POST',
      data: { orderIds: [order.id], courierMembershipId: board.couriers[0].membershipId },
    });
    const courierTrip = `${base}/courier/me/trips/${trip.id}`;
    await bff(page.request, `${courierTrip}/pickup`, { method: 'POST' });
    await bff(page.request, `${courierTrip}/start`, { method: 'POST' });
    await bff(page.request, `${courierTrip}/stops/${trip.stops[0].id}/deliver`, { method: 'POST', data: {} });

    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    await bff((await admin.newPage()).request, `admin/restaurants/${restaurant.id}/features/courier_tips`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    // The customer picks the middle suggestion and pays on the hosted page.
    const token = order.trackingUrl.split('/t/')[1];
    const guestContext = await browser.newContext({ locale: 'tr-TR' });
    const guest = await guestContext.newPage();
    await guest.goto(`/t/${token}`);
    const card = guest.getByRole('region', { name: 'Kuryeye bahşiş' });
    await expect(card).toContainText('Selim siparişinizi teslim etti');
    const amount = tipPresets(order.chargedToCustomerMinor, country.currency)[1];
    // The page leaves for the hosted payment page at once, so the tip id is read on the way through.
    let tipId = '';
    await guest.route(`**/api/bff/public/orders/${token}/tip`, async (route) => {
      const response = await route.fetch();
      tipId = ((await response.json()) as { tipId: string }).tipId;
      await route.fulfill({ response });
    });
    await card.getByRole('button', { name: /bahşiş ver$/ }).click();
    await guest.waitForURL(/mockSession=/);
    await expect(guest.locator('[data-tip-state="PENDING"]')).toBeVisible();

    // The platform merchant's signed notice settles it; the tracking page thanks the customer.
    const body = JSON.stringify({
      providerRef: `pw-tip-${Date.now()}`,
      orderRef: tipId,
      status: 'CAPTURED',
      amountMinor: amount,
      currency: country.currency,
      pspFeeMinor: 60,
      occurredAt: new Date().toISOString(),
    });
    const notice = await guest.request.post(`${API_URL}/webhooks/payments/platform/MOCK`, {
      headers: {
        'content-type': 'application/json',
        'x-mock-signature': createHmac('sha256', 'mock').update(body).digest('hex'),
      },
      data: body,
    });
    expect(notice.ok()).toBe(true);
    await guest.reload();
    await expect(guest.locator('[data-tip-state="CAPTURED"]')).toContainText('bahşişiniz için teşekkürler');

    // The restaurant sees it under its courier.
    await page.goto(`/panel/${restaurant.slug}/kurye`);
    const report = page.getByRole('region', { name: 'Bahşişler' });
    await expect(report.locator('[data-tips-totals]')).toContainText('1 bahşiş');
    await expect(report.getByRole('table', { name: 'Kuryeler' })).toContainText('Selim Bahsis');

    // The owner gives it back from the list with a reason; the warning says what is not taken back.
    const row = report.locator(`[data-tip-row="${tipId}"]`);
    await row.getByRole('button', { name: 'İade et' }).click();
    await expect(row.locator(`[data-tip-refund="${tipId}"]`)).toContainText('geri alınmaz');
    await expect(row.getByRole('button', { name: 'İadeyi onayla' })).toBeDisabled();
    await row.getByLabel('İade nedeni').fill('Müşteri yanlışlıkla verdi');
    await row.getByRole('button', { name: 'İadeyi onayla' }).click();
    await expect(report.getByRole('status')).toContainText('Bahşiş müşteriye iade edildi.');
    await expect(report.locator(`[data-tip-row="${tipId}"]`)).toContainText('İade edildi');
    await expect(report.locator(`[data-tip-row="${tipId}"]`)).toContainText('Müşteri yanlışlıkla verdi');

    await guestContext.close();
  });
});
