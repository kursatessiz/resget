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

test.describe('Order rating', () => {
  test.use({ storageState: OWNER_STATE });

  test('a completed order can be rated once from its tracking page', async ({ page, browser }) => {
    const me = await bff<Me>(page.request, 'auth/me');
    const restaurantId = me.memberships.find((m) => m.restaurantSlug === SEED.restaurantSlug)!.restaurantId;
    const restaurant = await bff<Restaurant>(page.request, `restaurants/${restaurantId}`);
    const menu = await bff<Category[]>(page.request, `restaurants/${restaurantId}/menu`);
    const item = menu.flatMap((c) => c.items).find((i) => i.name === SEED.firstMenuItem)!;
    const order = await bff<{ id: string; trackingUrl: string }>(page.request, `restaurants/${restaurantId}/orders`, {
      method: 'POST',
      data: {
        branchId: restaurant.branches[0].id,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: item.id, quantity: 1 }],
        customer: { fullName: 'Playwright Puan', phone: '0532 999 04 00' },
      },
    });
    for (const to of ['ACCEPTED', 'READY', 'PICKED_UP']) {
      await bff(page.request, `restaurants/${restaurantId}/orders/${order.id}/transition`, {
        method: 'POST',
        data: to === 'ACCEPTED' ? { to, prepMinutes: 5 } : { to },
      });
    }
    const token = order.trackingUrl.split('/t/')[1];

    // The customer follows the tracking link without any session.
    const guest = await browser.newContext({ storageState: undefined, locale: 'tr-TR' });
    const shop = await guest.newPage();
    await shop.goto(`/t/${token}`);
    await expect(shop.getByText('Siparişinizi teslim aldınız. Afiyet olsun.')).toBeVisible();
    const card = shop.getByRole('region', { name: 'Siparişinizi değerlendirin' });
    await card.getByLabel('4 puan').check();
    await card.getByLabel('Yorum (isteğe bağlı)').fill('Playwright yorumu');
    await card.getByRole('button', { name: 'Gönder' }).click();
    await expect(card.getByRole('status')).toContainText('Değerlendirmeniz: 4 / 5');
    await shop.reload();
    await expect(shop.getByRole('region', { name: 'Siparişinizi değerlendirin' })).toContainText(
      'Değerlendirmeniz: 4 / 5',
    );
    await guest.close();

    // The restaurant reads it in the reports.
    await page.goto(`/panel/${SEED.restaurantSlug}/raporlar`);
    await expect(page.getByRole('region', { name: 'Değerlendirmeler' })).toContainText('Playwright yorumu');
  });
});
