import { test, expect } from '@playwright/test';
import type { AdminRestaurantPageDTO } from '@resget/shared';
import { SEED } from './support/seed';
import { ADMIN_STATE, OWNER_STATE, bff } from './support/session';

interface Restaurant {
  branches: { id: string }[];
}
interface Category {
  items: { id: string; name: string }[];
}

const REVIEW_URL = 'https://g.page/r/pw-demo/review';

test.describe('Feedback and NPS', () => {
  test.use({ storageState: OWNER_STATE });

  test('a low rating opens a case, every rater sees the review link, NPS is asked once', async ({ page, browser }) => {
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    const found = await bff<AdminRestaurantPageDTO>(
      consolePage.request,
      `admin/restaurants?query=${SEED.restaurantSlug}`,
    );
    const restaurantId = found.items.find((r) => r.slug === SEED.restaurantSlug)!.id;
    const setSwitch = (enabled: boolean | null) =>
      bff(consolePage.request, `admin/restaurants/${restaurantId}/features/feedback`, {
        method: 'PUT',
        data: { enabled },
      });
    try {
      await setSwitch(true);
      await page.goto(`/panel/${SEED.restaurantSlug}/geri-bildirim`);
      await expect(page.getByRole('heading', { name: 'Geri bildirim', level: 1 })).toBeVisible();
      const settings = page.getByRole('region', { name: 'Ayarlar' });
      await settings.getByRole('textbox', { name: /^Değerlendirme sayfanız/ }).fill(REVIEW_URL);
      await settings.getByLabel('Takip sayfasında NPS sorusunu sor').check();
      await settings.getByRole('button', { name: 'Kaydet' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Ayarlar kaydedildi.' })).toBeVisible();

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
            fulfillment: 'PICKUP',
            items: [{ menuItemId: item.id, quantity: 1 }],
            customer: { fullName: 'Playwright Geri Bildirim', phone: '0532 999 04 71' },
          },
        },
      );
      for (const to of ['ACCEPTED', 'READY', 'PICKED_UP']) {
        await bff(page.request, `restaurants/${restaurantId}/orders/${order.id}/transition`, {
          method: 'POST',
          data: to === 'ACCEPTED' ? { to, prepMinutes: 5 } : { to },
        });
      }
      const token = order.trackingUrl.split('/t/')[1];

      const guest = await browser.newContext({ storageState: undefined, locale: 'tr-TR' });
      const shop = await guest.newPage();
      await shop.goto(`/t/${token}`);
      const rating = shop.getByRole('region', { name: 'Siparişinizi değerlendirin' });
      await rating.getByLabel('2 puan').check();
      await rating.getByLabel('Yorum (isteğe bağlı)').fill('Soguk geldi');
      await rating.getByRole('button', { name: 'Gönder' }).click();
      await expect(rating.getByRole('status')).toContainText('2 / 5');

      // A low score still gets the same review link: no review gating.
      const more = shop.getByRole('region', { name: 'Bir soru daha' });
      await expect(more.getByRole('link', { name: 'Değerlendirme yazın' })).toHaveAttribute('href', REVIEW_URL);
      await more.getByLabel('8 puan').check();
      await more.getByRole('button', { name: 'Gönder' }).click();
      await expect(more.getByRole('status')).toHaveText('Teşekkürler, yanıtınız kaydedildi.');
      await guest.close();

      await page.goto(`/panel/${SEED.restaurantSlug}/geri-bildirim`);
      const caseRow = page.locator(`[data-feedback-case="${order.shortCode}"]`);
      await expect(caseRow).toContainText('Soguk geldi');
      await caseRow.getByLabel('Not').fill('Musteri arandi');
      await caseRow.getByRole('button', { name: 'Çözüldü olarak işaretle' }).click();
      await expect(caseRow).toHaveCount(0);
      await page.getByRole('button', { name: 'Tümü' }).click();
      await expect(page.locator(`[data-feedback-case="${order.shortCode}"]`)).toContainText('Çözüldü');
      await expect(page.locator('[data-feedback-nps]')).toContainText('NPS:');
    } finally {
      await setSwitch(null);
      await admin.close();
    }
  });
});
