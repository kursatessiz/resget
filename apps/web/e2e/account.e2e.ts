import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { signIn } from './support/session';

test.describe('Customer account', () => {
  test('a guest signs in, saves an address and sees it offered on the restaurant page', async ({ page }) => {
    await signIn(page, SEED.guestPhone);
    await page.goto('/hesabim');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hesabım');
    const label = `PW Ev ${Date.now().toString(36)}`;
    await page.getByLabel('Adres adı (Ev, İş)').fill(label);
    await page.getByLabel('Adres', { exact: true }).fill('Moda Cad. No 12 D 5');
    await page.getByLabel('İl', { exact: true }).fill('Istanbul');
    await page.getByLabel('İlçe', { exact: true }).fill('Kadikoy');
    await page.getByRole('button', { name: 'Adres ekle' }).click();
    await expect(page.getByText('Adres kaydedildi.')).toBeVisible();
    await expect(page.getByRole('listitem', { name: label })).toBeVisible();

    await page.goto(`/${SEED.restaurantSlug}`);
    await expect(page.getByText(/Hoş geldiniz,/)).toBeVisible();
    await page
      .locator(`[data-menu-item="${SEED.firstMenuItem}"]`)
      .getByRole('button', { name: `Ekle: ${SEED.firstMenuItem}` })
      .click();
    await page.getByLabel('Eve teslim').check();
    const saved = page.getByLabel('Kayıtlı adres');
    await expect(saved).toBeVisible();
    await saved.selectOption({ label: `${label}: Moda Cad. No 12 D 5` });
    await expect(page.getByLabel('Adres', { exact: true })).toHaveValue('Moda Cad. No 12 D 5');

    await page.goto('/hesabim');
    await page.getByRole('listitem', { name: label }).getByRole('button', { name: 'Sil' }).click();
    await expect(page.getByRole('listitem', { name: label })).toHaveCount(0);
  });
});
