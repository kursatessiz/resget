import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { OWNER_STATE } from './support/session';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test.describe('Restaurant logo', () => {
  test.use({ storageState: OWNER_STATE });

  test('the owner uploads a logo, sees it in the panel and removes it', async ({ page }) => {
    await page.goto(`/panel/${SEED.restaurantSlug}/ayarlar`);
    await page.getByLabel('Logo dosyası').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1X1 });
    await page.getByRole('button', { name: 'Logoyu yükle' }).click();
    await expect(page.getByText('Logo yüklendi.')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Mevcut logo' })).toBeVisible();
    await page.getByRole('button', { name: 'Logoyu kaldır' }).click();
    await expect(page.getByRole('img', { name: 'Mevcut logo' })).toHaveCount(0);
  });
});
