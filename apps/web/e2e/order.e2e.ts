import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';

test.describe('Ordering from the table QR and the marketplace', () => {
  test('a guest orders to the table with cash and lands on the tracking page', async ({ page }) => {
    await page.goto(`/m/${SEED.tableToken}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${SEED.restaurantName} menüsü`);
    const item = page.locator(`[data-menu-item="${SEED.firstMenuItem}"]`);
    await item.getByRole('button', { name: `Ekle: ${SEED.firstMenuItem}` }).click();
    const cart = page.getByRole('region', { name: 'Sepet' });
    await expect(cart).toContainText(SEED.firstMenuItem);
    await cart.getByRole('button', { name: `Ekle: ${SEED.firstMenuItem}` }).click();
    await expect(cart.getByLabel('Adet')).toHaveText('2');

    await page.getByLabel(/Masaya getirilsin/).check();
    await page.getByLabel('Kapıda nakit').check();
    await page.getByLabel('Sipariş notu (isteğe bağlı)').fill('pw-order');
    await page.getByRole('button', { name: 'Siparişi ver' }).click();
    await page.waitForURL(/\/t\//, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(SEED.restaurantName);
  });

  test('the marketplace lists the demo restaurant and its page takes delivery orders', async ({ page }) => {
    await page.goto('/pazaryeri');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Yakınınızdaki restoranlar');
    const card = page.getByRole('region', { name: SEED.restaurantName });
    await expect(card).toBeVisible();
    await card.getByRole('link', { name: 'Menüyü aç' }).click();
    await page.waitForURL(new RegExp(`/${SEED.restaurantSlug}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(SEED.restaurantName);
    await page
      .locator(`[data-menu-item="${SEED.firstMenuItem}"]`)
      .getByRole('button', { name: `Ekle: ${SEED.firstMenuItem}` })
      .click();
    await page.getByLabel('Eve teslim').check();
    await page.getByLabel('Adınız').fill('PW Musteri');
    await page.getByLabel('Telefon numaranız').fill('05329990911');
    await page.getByLabel('Adres', { exact: true }).fill('Bagdat Cad. No 12 D 3');
    await page.getByLabel('İl', { exact: true }).fill('Istanbul');
    await page.getByLabel('İlçe', { exact: true }).fill('Kadikoy');
    await page.getByLabel('Kapıda nakit').check();
    await page.getByRole('button', { name: 'Siparişi ver' }).click();
    await page.waitForURL(/\/t\//, { timeout: 20_000 });
    // A delivery order's tracking page shows the courier leg among its steps.
    await expect(page.getByText('Yolda')).toBeVisible();
  });
});
