import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { OWNER_STATE } from './support/session';

test.describe('Campaigns (PRO)', () => {
  test.use({ storageState: OWNER_STATE });

  test('the owner drafts a campaign, previews the audience and credits, and sees it in the list', async ({ page }) => {
    const name = `PW Kampanya ${Date.now().toString(36)}`;
    await page.goto(`/panel/${SEED.restaurantSlug}/kampanyalar`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kampanyalar');
    await page.getByLabel('Kampanya adı').fill(name);
    await page.getByLabel('Mesaj').fill('Bu hafta tum tatlilar yuzde 20 indirimli.');
    await page.getByRole('button', { name: 'Taslağı kaydet' }).click();
    await expect(page.getByText('Kampanya kaydedildi.')).toBeVisible();
    const preview = page.getByRole('region', { name: 'Gönderim önizlemesi' });
    await expect(preview).toContainText('Alıcı:');
    await expect(preview).toContainText('Gereken kredi:');
    await expect(preview).toContainText('/iptal/');
    await expect(page.getByRole('listitem', { name })).toContainText('Taslak');
  });

  test('the owner saves a segment, counts its audience, picks it for a campaign and deletes it', async ({ page }) => {
    const name = `PW Segment ${Date.now().toString(36)}`;
    await page.goto(`/panel/${SEED.restaurantSlug}/kampanyalar`);
    await page.getByLabel('En az sipariş sayısı').fill('1');
    await page.getByRole('button', { name: 'Alıcıyı say' }).click();
    await expect(page.getByRole('status')).toContainText(/izinli müşteriye denk geliyor/);
    await page.getByLabel('Segment adı').fill(name);
    await page.getByRole('button', { name: 'Segmenti kaydet' }).click();
    await expect(page.getByText('Segment kaydedildi.')).toBeVisible();
    const picker = page.getByRole('combobox', { name: 'Kayıtlı segment' });
    await expect(picker.locator('option', { hasText: name })).toHaveCount(1);
    await picker.selectOption({
      label: await picker
        .locator('option', { hasText: name })
        .textContent()
        .then((s) => s ?? ''),
    });
    await expect(page.getByLabel('En az sipariş sayısı')).toHaveValue('1');
    const row = page.getByRole('region', { name: 'Kayıtlı segmentler' }).getByRole('listitem', { name });
    await row.getByRole('button', { name: 'Sil' }).click();
    await expect(page.getByText('Segment silindi.')).toBeVisible();
    await expect(picker.locator('option', { hasText: name })).toHaveCount(0);
  });
});
