import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { OWNER_STATE } from './support/session';

test.describe('API access (PRO)', () => {
  test.use({ storageState: OWNER_STATE });

  test('the owner mints a scoped key with a lifetime, reads it once, sees its use and revokes it', async ({ page }) => {
    const name = `PW Kasa ${Date.now().toString(36)}`;
    await page.goto(`/panel/${SEED.restaurantSlug}/entegrasyon`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('API erişimi');
    const form = page.getByRole('region', { name: 'Yeni anahtar' });
    await form.getByLabel('Anahtar adı (örneğin Kasa yazılımı)').fill(name);
    await form.getByLabel('Geçerlilik süresi').selectOption('90');
    await form.getByRole('button', { name: 'Anahtar oluştur' }).click();
    await expect(page.getByRole('status')).toContainText('Anahtar oluşturuldu');
    await expect(page.locator('[data-api-key-token]')).toContainText(/^rsk_[0-9a-f]{16}_/);
    const row = page.getByRole('region', { name: 'Anahtarlar' }).getByRole('listitem', { name });
    await expect(row).toContainText('Etkin');
    await expect(row.locator('[data-api-key-usage-summary]')).toContainText('Son geçerlilik:');
    await expect(row.locator('[data-api-key-usage-summary]')).toContainText('Son 30 günde 0 istek');
    await row.getByRole('button', { name: 'Kullanım', exact: true }).click();
    await expect(row.getByRole('region', { name: 'Günlük istekler (UTC)' })).toContainText('Bu dönemde istek yok.');
    await row.getByRole('button', { name: 'Kullanımı gizle' }).click();
    await expect(row.getByRole('region', { name: 'Günlük istekler (UTC)' })).toHaveCount(0);
    await row.getByRole('button', { name: 'İptal et' }).click();
    await expect(page.getByRole('status')).toContainText('Anahtar iptal edildi');
    await expect(row).toContainText('İptal edildi');
    await expect(page.locator('[data-api-key-token]')).toHaveCount(0);
  });

  test('the owner registers a webhook, reads its secret once, pauses and deletes it', async ({ page }) => {
    const url = `https://example.com/hooks/${Date.now().toString(36)}`;
    await page.goto(`/panel/${SEED.restaurantSlug}/entegrasyon`);
    const card = page.getByRole('region', { name: 'Webhook adresleri' });
    await card.getByLabel('Adres (https://...)').fill(url);
    await card.getByRole('button', { name: 'Webhook ekle' }).click();
    await expect(card.getByRole('status')).toContainText('Webhook eklendi');
    await expect(card.locator('[data-webhook-secret]')).toContainText(/^whsec_/);
    const row = card.getByRole('listitem', { name: url });
    await expect(row).toContainText('Etkin');
    await row.getByRole('button', { name: 'Duraklat' }).click();
    await expect(row).toContainText('Duraklatıldı');
    await row.getByRole('button', { name: 'Sil' }).click();
    await expect(card.getByRole('status')).toContainText('Webhook silindi');
    await expect(card.getByRole('listitem', { name: url })).toHaveCount(0);
  });
});
