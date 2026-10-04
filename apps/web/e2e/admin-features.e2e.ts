import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { ADMIN_STATE, OWNER_STATE } from './support/session';

test.describe('Console feature switches', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the super admin switches a module off for everyone and the owner panel hides it', async ({ page, browser }) => {
    await page.goto('/admin/ozellikler');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Özellik anahtarları');
    const marketing = page.getByRole('region', { name: 'Pazarlama' });
    const loyalty = marketing.locator('[data-feature="loyalty"]');
    await expect(loyalty).toContainText('Sadakat programı');
    await loyalty.getByLabel('Genel ayar').selectOption('off');
    await expect(loyalty.locator('.pui-badge').first()).toHaveText('Kapalı');

    const owner = await browser.newContext({ storageState: OWNER_STATE, locale: 'tr-TR' });
    const panel = await owner.newPage();
    try {
      await panel.goto(`/panel/${SEED.restaurantSlug}`);
      const nav = panel.getByRole('complementary');
      await expect(nav.getByRole('link', { name: 'Siparişler' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Sadakat' })).toHaveCount(0);
    } finally {
      await loyalty.getByLabel('Genel ayar').selectOption('default');
      await expect(loyalty.locator('.pui-badge').first()).toHaveText('Açık');
      await owner.close();
    }
  });
});
