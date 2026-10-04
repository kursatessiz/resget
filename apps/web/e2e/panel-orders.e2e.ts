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

test.describe('Orders screen and dispatch board', () => {
  test.use({ storageState: OWNER_STATE });

  test('a phone order flows from new to ready on the orders screen and into a trip on the dispatch board', async ({
    page,
  }) => {
    const me = await bff<Me>(page.request, 'auth/me');
    const restaurantId = me.memberships.find((m) => m.restaurantSlug === SEED.restaurantSlug)!.restaurantId;
    const restaurant = await bff<Restaurant>(page.request, `restaurants/${restaurantId}`);
    const menu = await bff<Category[]>(page.request, `restaurants/${restaurantId}/menu`);
    const item = menu.flatMap((c) => c.items).find((i) => i.name === SEED.firstMenuItem)!;
    const order = await bff<{ id: string; shortCode: string }>(page.request, `restaurants/${restaurantId}/orders`, {
      method: 'POST',
      data: {
        branchId: restaurant.branches[0].id,
        channel: 'PHONE',
        fulfillment: 'DELIVERY',
        items: [{ menuItemId: item.id, quantity: 1 }],
        address: {
          addressLine: 'Bahariye Cad. No 12 D 3',
          city: 'Istanbul',
          district: 'Kadikoy',
          contactName: 'Playwright Musteri',
          contactPhone: '0532 999 03 00',
          point: { lat: 40.9885, lng: 29.0275 },
        },
        payment: { method: 'CASH_ON_DELIVERY' },
        note: 'pw-panel',
      },
    });
    const card = page.locator(`[data-order-code="${order.shortCode}"]`);

    await page.goto(`/panel/${SEED.restaurantSlug}/siparisler`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Siparişler');
    await expect(card).toBeVisible();
    await expect(card.getByText('Yeni', { exact: true })).toBeVisible();
    await expect(card.getByText(/Kapıda tahsil edilecek/)).toBeVisible();

    await card.getByRole('button', { name: 'Kabul et' }).click();
    await card.getByRole('button', { name: 'Kabul et' }).click();
    await expect(card.getByText('Kabul edildi', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Hazırlanıyor' }).click();
    await expect(card.getByText('Hazırlanıyor', { exact: true }).first()).toBeVisible();
    await card.getByRole('button', { name: 'Hazır', exact: true }).click();
    await expect(card.getByText('Hazır', { exact: true }).first()).toBeVisible();

    await page.goto(`/panel/${SEED.restaurantSlug}/sevk`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sevk');
    const ready = page.getByRole('region', { name: 'Sevk bekleyen siparişler' });
    await ready.getByLabel(`Sipariş ${order.shortCode}`).check();
    await page.getByLabel('Kurye').first().selectOption({ label: 'Demo Kurye' });
    await page.getByRole('button', { name: 'Sefer oluştur' }).click();
    const trips = page.getByRole('region', { name: 'Aktif seferler' });
    await expect(trips.getByText('Kurye atandı')).toBeVisible();
    await expect(trips.getByText(`Sipariş ${order.shortCode}`)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Kuryeler' }).getByText('Seferde')).toBeVisible();
    // The map section is always there; it draws when a courier shares a position or a stop has coordinates.
    await expect(page.getByRole('region', { name: 'Harita' }).first()).toBeVisible();

    await trips.getByRole('button', { name: 'Seferi iptal et' }).click();
    await expect(trips.getByText('Aktif sefer yok.')).toBeVisible();
    await expect(ready.getByText(`Sipariş ${order.shortCode}`)).toBeVisible();
  });
  test('a cancelled order whose money was taken at the counter is refunded from its card with a reason', async ({
    page,
  }) => {
    const me = await bff<Me>(page.request, 'auth/me');
    const restaurantId = me.memberships.find((m) => m.restaurantSlug === SEED.restaurantSlug)!.restaurantId;
    const restaurant = await bff<Restaurant>(page.request, `restaurants/${restaurantId}`);
    const menu = await bff<Category[]>(page.request, `restaurants/${restaurantId}/menu`);
    const item = menu.flatMap((c) => c.items).find((i) => i.name === SEED.firstMenuItem)!;
    const base = `restaurants/${restaurantId}/orders`;
    const order = await bff<{ id: string; shortCode: string }>(page.request, base, {
      method: 'POST',
      data: {
        branchId: restaurant.branches[0].id,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: item.id, quantity: 1 }],
        customer: { fullName: 'Playwright Iade', phone: '0532 999 03 01' },
        payment: { method: 'CASH_ON_DELIVERY' },
        note: 'pw-refund',
      },
    });
    await bff(page.request, `${base}/${order.id}/transition`, {
      method: 'POST',
      data: { to: 'ACCEPTED', prepMinutes: 10 },
    });
    await bff(page.request, `${base}/${order.id}/collect`, { method: 'POST', data: { method: 'CASH_ON_DELIVERY' } });
    await bff(page.request, `${base}/${order.id}/transition`, {
      method: 'POST',
      data: { to: 'CANCELLED_BY_RESTAURANT', reason: 'Musteri vazgecti' },
    });
    const card = page.locator(`[data-order-code="${order.shortCode}"]`);

    await page.goto(`/panel/${SEED.restaurantSlug}/siparisler`);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'İade et' }).click();
    const confirm = card.getByRole('button', { name: 'İadeyi onayla' });
    await expect(confirm).toBeDisabled();
    await card.getByLabel('İade nedeni').fill('Nakit elden iade edildi');
    await confirm.click();
    await expect(card.getByText('İade edildi', { exact: true })).toBeVisible();
    await expect(card.getByText(/İade edildi: /)).toBeVisible();
    await expect(card.getByRole('button', { name: 'İade et' })).toHaveCount(0);
  });
});
