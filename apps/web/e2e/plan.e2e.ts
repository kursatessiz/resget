import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { OWNER_STATE } from './support/session';

test.describe('Plan and message credits', () => {
  test.use({ storageState: OWNER_STATE });

  test('the owner sees the wallets, saves notification settings, adds a card and buys a package', async ({ page }) => {
    await page.goto(`/panel/${SEED.restaurantSlug}/plan`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan ve mesaj kredileri');
    const wallets = page.getByRole('region', { name: 'Mesaj kredileri' });
    await expect(wallets.locator('[data-wallet="SMS"]')).toContainText('kredi');

    const settings = page.getByRole('region', { name: 'Müşteri bildirimleri' });
    await settings.getByRole('combobox', { name: 'Tercih edilen kanal' }).selectOption('SMS');
    await settings.getByRole('button', { name: 'Kaydet' }).click();
    await expect(settings.getByText('Kaydedildi.')).toBeVisible();

    // Card linking goes through the vault's own page and returns here; the mock vault returns at once.
    const packages = page.getByRole('region', { name: 'Kredi paketi satın al' });
    if ((await packages.getByLabel('Ödeme kartı').count()) === 0) {
      await packages.getByRole('button', { name: 'Kart ekle' }).click();
      await page.waitForURL(/\/plan/);
      await expect(page.getByRole('region', { name: 'Kredi paketi satın al' }).getByLabel('Ödeme kartı')).toBeVisible({
        timeout: 15_000,
      });
    }
    const before = Number(
      ((await wallets.locator('[data-wallet="SMS"]').textContent()) ?? '').replace(/[^\d]/g, '') || '0',
    );
    await page.getByRole('region', { name: 'Kredi paketi satın al' }).getByRole('button', { name: 'Satın al' }).click();
    await expect(page.getByText('Satın alma tamamlandı, krediler yüklendi.')).toBeVisible();
    const after = Number(
      (
        (await page.getByRole('region', { name: 'Mesaj kredileri' }).locator('[data-wallet="SMS"]').textContent()) ?? ''
      ).replace(/[^\d]/g, '') || '0',
    );
    expect(after).toBeGreaterThan(before);
  });
});
