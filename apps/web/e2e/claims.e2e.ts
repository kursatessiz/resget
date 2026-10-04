import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { OWNER_STATE, bff } from './support/session';

interface Me {
  memberships: { restaurantId: string; restaurantSlug: string }[];
}
interface Restaurant {
  branches: { id: string }[];
}
interface Category {
  items: { id: string; name: string }[];
}

test.describe('Missing-item claims', () => {
  test.use({ storageState: OWNER_STATE });

  test('the customer reports a missing portion and the restaurant pays it out from the order card', async ({
    page,
    browser,
  }) => {
    const me = await bff<Me>(page.request, 'auth/me');
    const restaurantId = me.memberships.find((m) => m.restaurantSlug === SEED.restaurantSlug)!.restaurantId;
    const restaurant = await bff<Restaurant>(page.request, `restaurants/${restaurantId}`);
    const menu = await bff<Category[]>(page.request, `restaurants/${restaurantId}/menu`);
    const item = menu.flatMap((c) => c.items).find((i) => i.name === SEED.firstMenuItem)!;
    const base = `restaurants/${restaurantId}/orders`;
    const order = await bff<{ id: string; shortCode: string; trackingUrl: string }>(page.request, base, {
      method: 'POST',
      data: {
        branchId: restaurant.branches[0].id,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: item.id, quantity: 2 }],
        customer: { fullName: 'Playwright Eksik', phone: '0532 999 04 01' },
        payment: { method: 'CASH_ON_DELIVERY' },
      },
    });
    for (const step of [{ to: 'ACCEPTED', prepMinutes: 5 }, { to: 'READY' }, { to: 'PICKED_UP' }]) {
      await bff(page.request, `${base}/${order.id}/transition`, { method: 'POST', data: step });
    }
    await bff(page.request, `${base}/${order.id}/collect`, { method: 'POST', data: { method: 'CASH_ON_DELIVERY' } });
    const token = order.trackingUrl.split('/t/')[1];

    // The customer reports from the tracking link, without any session.
    const guest = await browser.newContext({ storageState: undefined, locale: 'tr-TR' });
    const shop = await guest.newPage();
    await shop.goto(`/t/${token}`);
    const claim = shop.getByRole('region', { name: 'Eksik ürün' });
    await claim.getByRole('button', { name: 'Eksik ürün bildir' }).click();
    const send = claim.getByRole('button', { name: 'Bildirimi gönder' });
    await expect(send).toBeDisabled();
    await claim.getByLabel(`${item.name} (en fazla 2 adet)`).selectOption('1');
    await claim.getByLabel('Not (isteğe bağlı)').fill('Bir porsiyon gelmedi');
    await send.click();
    await expect(claim.getByRole('status')).toContainText('Bildiriminiz işletmeye iletildi');

    // The restaurant sees the report on the order card and approves it.
    const card = page.locator(`[data-order-code="${order.shortCode}"]`);
    await page.goto(`/panel/${SEED.restaurantSlug}/siparisler`);
    await expect(card.getByText('Eksik ürün bildirimi', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Bildirimi incele' }).click();
    await expect(card.getByText('Bir porsiyon gelmedi')).toBeVisible();
    await card.getByRole('button', { name: 'Onayla ve iade et' }).click();
    await expect(card.getByText(/Kısmi iade: /)).toBeVisible();
    await expect(card.getByText('Eksik ürün bildirimi', { exact: true })).toHaveCount(0);

    // The customer reads the outcome.
    await shop.reload();
    await expect(shop.getByRole('region', { name: 'Eksik ürün' }).getByRole('status')).toContainText(
      'Bildiriminiz onaylandı',
    );
    await guest.close();
  });
});
