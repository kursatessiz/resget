import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { ADMIN_STATE, signIn } from './support/session';

test.describe('Platform console', () => {
  test.describe('signed in as the super admin', () => {
    test.use({ storageState: ADMIN_STATE });

    test('the super admin sees the density board, the restaurants, the areas and the plans', async ({ page }) => {
      await page.goto('/admin');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Özet');
      await expect(page.getByRole('region', { name: 'İlçe bazlı sipariş yoğunluğu' })).toContainText('Kadikoy');

      await page.goto('/admin/restoranlar');
      const row = page.locator(`[data-restaurant-slug="${SEED.restaurantSlug}"]`);
      await expect(row).toBeVisible();
      await row.getByRole('link', { name: 'Aç' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(SEED.restaurantName);
      await expect(page.getByText(/Sahip: Demo Sahip/)).toBeVisible();

      await page.goto('/admin/bolgeler');
      await expect(page.locator('[data-area="Istanbul/Kadikoy"]')).toContainText('Açık');
      await expect(page.locator('[data-area="Istanbul/Kadikoy"] [data-readiness]')).toContainText(
        /hazır restoran, OARD/,
      );
      await expect(page.getByRole('region', { name: 'Aday ilçeler' })).toBeVisible();

      await page.goto('/admin/bildirimler');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Yükseltilen bildirimler');

      await page.goto('/admin/planlar');
      await expect(page.getByRole('region', { name: 'Pro' })).toBeVisible();
      await expect(page.locator('[data-package="sms-500"]')).toBeVisible();
    });
  });

  test('a restaurant owner gets a 404 from the console', async ({ page }) => {
    await signIn(page, SEED.courierPhone);
    const res = await page.goto('/admin');
    expect(res?.status()).toBe(404);
  });
});
