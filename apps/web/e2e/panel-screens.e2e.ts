import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { OWNER_STATE } from './support/session';

test.describe('Customers, reports, courier and campaigns screens', () => {
  test.use({ storageState: OWNER_STATE });

  test('every navigation link of the owner opens a screen', async ({ page }) => {
    await page.goto(`/panel/${SEED.restaurantSlug}/musteriler`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Müşteriler');
    await expect(page.getByRole('heading', { name: 'Toplam müşteri' })).toBeVisible();

    await page.goto(`/panel/${SEED.restaurantSlug}/raporlar`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Raporlar');
    await expect(page.getByRole('heading', { name: 'Tamamlanan sipariş' })).toBeVisible();
    await page.getByLabel('Dönem').selectOption('30');
    await expect(page.getByRole('heading', { name: 'En çok satan ürünler' })).toBeVisible();

    await page.goto(`/panel/${SEED.restaurantSlug}/kurye`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kurye');
    await expect(page.getByRole('heading', { name: 'Kendi kuryelerimiz' })).toBeVisible();

    await page.goto(`/panel/${SEED.restaurantSlug}/kampanyalar`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kampanyalar');

    await page.goto(`/panel/${SEED.restaurantSlug}/entegrasyon`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('API erişimi');
    await expect(page.getByRole('region', { name: 'Nasıl kullanılır' })).toContainText('x-api-key');
  });
});
