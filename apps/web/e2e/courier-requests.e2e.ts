import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { OWNER_STATE, bff } from './support/session';

const API_URL = 'http://localhost:4000';
/** The development network's signature secret when COURIER_WEBHOOK_SECRET is not set. */
const SECRET = 'mock-courier-secret';

interface Me {
  memberships: { restaurantId: string; restaurantSlug: string }[];
}
interface Restaurant {
  branches: { id: string }[];
}
interface Category {
  items: { id: string; name: string }[];
}

test.describe('Courier network calls', () => {
  test.use({ storageState: OWNER_STATE });

  test('the restaurant calls a courier from the order card and the network carries the order', async ({
    page,
    browser,
  }) => {
    const me = await bff<Me>(page.request, 'auth/me');
    const restaurantId = me.memberships.find((m) => m.restaurantSlug === SEED.restaurantSlug)!.restaurantId;
    const restaurant = await bff<Restaurant>(page.request, `restaurants/${restaurantId}`);
    const menu = await bff<Category[]>(page.request, `restaurants/${restaurantId}/menu`);
    const item = menu.flatMap((c) => c.items).find((i) => i.name === SEED.firstMenuItem)!;
    const order = await bff<{ id: string; shortCode: string; trackingUrl: string }>(
      page.request,
      `restaurants/${restaurantId}/orders`,
      {
        method: 'POST',
        data: {
          branchId: restaurant.branches[0].id,
          channel: 'PHONE',
          fulfillment: 'DELIVERY',
          items: [{ menuItemId: item.id, quantity: 1 }],
          address: {
            addressLine: 'Bahariye Cad. No 40 D 2',
            city: 'Istanbul',
            district: 'Kadikoy',
            contactName: 'Ag Musteri',
            contactPhone: '0532 999 04 40',
            point: { lat: 40.9885, lng: 29.0275 },
          },
          payment: { method: 'CASH_ON_DELIVERY' },
          note: 'pw-courier-network',
        },
      },
    );
    await bff(page.request, `restaurants/${restaurantId}/orders/${order.id}/transition`, {
      method: 'POST',
      data: { to: 'ACCEPTED', prepMinutes: 10 },
    });

    await page.goto(`/panel/${SEED.restaurantSlug}/siparisler`);
    const card = page.locator(`[data-order-code="${order.shortCode}"]`);
    await card.getByRole('button', { name: 'Kurye çağır' }).click();
    await expect(card.locator('[data-courier-request]')).toContainText('Mock courier network: Çağrıldı');
    await expect(card.getByRole('button', { name: 'Kurye çağrısını iptal et' })).toBeVisible();

    // The network picks the parcel up; the card and the customer's page follow.
    const body = JSON.stringify({
      providerRef: `mock-${order.id}`,
      kind: 'PICKED_UP',
      occurredAt: new Date().toISOString(),
    });
    const notice = await page.request.post(`${API_URL}/webhooks/courier/MOCK`, {
      headers: {
        'content-type': 'application/json',
        'x-mock-signature': createHmac('sha256', SECRET).update(body).digest('hex'),
      },
      data: body,
    });
    expect(notice.ok()).toBe(true);
    await expect(card.locator('[data-courier-request]')).toContainText('Teslim alındı');
    await expect(card.getByRole('button', { name: 'Kurye çağrısını iptal et' })).toHaveCount(0);

    const guestContext = await browser.newContext({ locale: 'tr-TR' });
    const guest = await guestContext.newPage();
    await guest.goto(`/t/${order.trackingUrl.split('/t/')[1]}`);
    await expect(guest.locator('[data-courier-network]')).toContainText(
      'Siparişinizi Mock courier network kuryesi getiriyor.',
    );
    await guestContext.close();
  });
});
