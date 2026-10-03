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
});
