import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';

test.describe('Order tracking page', () => {
  test('shows the seeded order, its steps and goes live over server-sent events', async ({ page }) => {
    const response = await page.goto(`/t/${SEED.trackingToken}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`${SEED.restaurantName} siparişiniz`);
    await expect(page.getByText('Siparişiniz işletmeye iletildi, onay bekleniyor.')).toBeVisible();
    await expect(page.getByText('Sipariş alındı')).toBeVisible();
    await expect(page.getByText('Teslim edildi')).toBeVisible();
    await expect(page.getByText(SEED.firstMenuItem)).toBeVisible();
    // The event stream delivers the snapshot through the BFF; the page marks itself live.
    await expect(page.getByText('Canlı')).toBeVisible({ timeout: 15_000 });
  });

  test('an unknown token shows the not-found message with a 404', async ({ page }) => {
    const response = await page.goto('/t/bilinmeyen-takip-token-00000000');
    expect(response?.status()).toBe(404);
    await expect(page.getByText('Bu takip bağlantısı geçerli değil.')).toBeVisible();
  });
});
