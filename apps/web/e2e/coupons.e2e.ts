import { test, expect } from '@playwright/test';
import type { AdminRestaurantPageDTO } from '@resget/shared';
import { SEED } from './support/seed';
import { ADMIN_STATE, OWNER_STATE, bff } from './support/session';

test.describe('Coupons', () => {
  test.use({ storageState: OWNER_STATE });

  test('the owner creates a coupon, a customer applies it on the menu page, and the unused coupon is deleted', async ({
    page,
    browser,
  }) => {
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    const page1 = await bff<AdminRestaurantPageDTO>(
      consolePage.request,
      `admin/restaurants?query=${SEED.restaurantSlug}`,
    );
    const restaurantId = page1.items.find((r) => r.slug === SEED.restaurantSlug)?.id;
    const setSwitch = (enabled: boolean | null) =>
      bff(consolePage.request, `admin/restaurants/${restaurantId}/features/coupons`, {
        method: 'PUT',
        data: { enabled },
      });
    const code = `PW-${Date.now().toString(36).toUpperCase()}`;
    try {
      expect(restaurantId).toBeTruthy();
      await setSwitch(true);

      await page.goto(`/panel/${SEED.restaurantSlug}/kuponlar`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kuponlar');
      const form = page.getByRole('region', { name: 'Yeni kupon' });
      await form.getByLabel('Kod').fill(code);
      await form.getByLabel('İndirim türü').selectOption('AMOUNT');
      await form.getByLabel(/İndirim tutarı/).fill('10');
      await form.getByRole('button', { name: 'Kuponu oluştur' }).click();
      const row = page.locator(`[data-coupon="${code}"]`);
      await expect(row).toContainText('Açık');

      await page.goto(`/${SEED.restaurantSlug}`);
      await page.getByRole('button', { name: `Ekle: ${SEED.firstMenuItem}` }).click();
      const coupon = page.locator('[data-coupon]');
      await coupon.getByLabel('Kupon kodu').fill(code.toLowerCase());
      await coupon.getByRole('button', { name: 'Uygula' }).click();
      await expect(coupon).toContainText(`${code} uygulandı`);
      await expect(page.locator('[data-coupon-line]')).toContainText(code);

      await page.goto(`/panel/${SEED.restaurantSlug}/kuponlar`);
      await page.locator(`[data-coupon="${code}"]`).getByRole('button', { name: 'Sil' }).click();
      await expect(page.locator(`[data-coupon="${code}"]`)).toHaveCount(0);
    } finally {
      await setSwitch(null).catch(() => undefined);
      await admin.close();
    }
  });
});
