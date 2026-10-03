import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';

test.describe('Table QR menu page', () => {
  test('opens the menu of the table without sign-in and shows prices in the viewer locale', async ({ page }) => {
    const response = await page.goto(`/m/${SEED.tableToken}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(SEED.restaurantName);
    await expect(page.getByText('Masa 1')).toBeVisible();
    await expect(page.getByText(SEED.firstMenuItem)).toBeVisible();
    // Turkish currency formatting of the seeded 420,00 TL item.
    await expect(page.getByText(/420,00/)).toBeVisible();
    // Ordering happens on the page itself (docs/VITRIN.md): every item carries an add button; order.e2e.ts covers the basket.
    await expect(page.getByRole('button', { name: `Ekle: ${SEED.firstMenuItem}` })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bir dahaki sefere eve sipariş ver' })).toBeVisible();
    // The seeded restaurant takes two meal cards at the door.
    await expect(page.getByText('Kabul edilen yemek kartları: Edenred, Multinet')).toBeVisible();
  });

  test('an unknown token shows the not-found message with a 404', async ({ page }) => {
    const response = await page.goto('/m/bilinmeyen-token-0000000000');
    expect(response?.status()).toBe(404);
    await expect(page.getByText('Bu QR kod geçerli değil')).toBeVisible();
  });
});
