import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { OWNER_STATE } from './support/session';

test.describe('Menu import', () => {
  test.use({ storageState: OWNER_STATE });

  test('the owner previews a spreadsheet, sees a bad line, fixes it and imports', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const category = `PW Import ${stamp}`;
    await page.goto(`/panel/${SEED.restaurantSlug}/menu`);
    const card = page.getByRole('region', { name: 'Menüyü dosyadan içe aktar' });
    await expect(card).toBeVisible();

    const bad = ['kategori;ürün adı;fiyat', `${category};Mercimek çorbası;85`, `${category};Ezogelin;fiyat yok`].join(
      '\n',
    );
    await card
      .getByLabel('CSV dosyası')
      .setInputFiles({ name: 'menu.csv', mimeType: 'text/csv', buffer: Buffer.from(bad) });
    await card.getByRole('button', { name: 'Ön izle' }).click();
    await expect(card.getByText('Satır 3: Fiyat okunamadı (örnek: 120 veya 120,50).')).toBeVisible();
    await expect(card.getByRole('button', { name: 'İçe aktar' })).toBeDisabled();

    const good = ['kategori;ürün adı;fiyat', `${category};Mercimek çorbası;85`, `${category};Ezogelin;90,50`].join(
      '\n',
    );
    await card
      .getByLabel('CSV dosyası')
      .setInputFiles({ name: 'menu.csv', mimeType: 'text/csv', buffer: Buffer.from(good) });
    await card.getByRole('button', { name: 'Ön izle' }).click();
    await expect(card.getByText('2 satır: 2 yeni ürün, 0 güncellenecek, 0 değişmeyecek.')).toBeVisible();
    await card.getByRole('button', { name: 'İçe aktar' }).click();
    await expect(card.getByText('Menü güncellendi.')).toBeVisible();
    const imported = page.getByRole('region', { name: category });
    await expect(imported.getByText('Ezogelin')).toBeVisible();
    await expect(imported.getByText(/90,50/)).toBeVisible();
  });
});
