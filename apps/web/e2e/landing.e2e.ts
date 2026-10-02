import { test, expect } from '@playwright/test';

test.describe('Landing page', () => {
  test('renders the headline, the four pillars and the calls to action in Turkish', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('yüzde 1');
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(4);
    await expect(page.getByRole('link', { name: 'İşletmeni kaydet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Giriş yap' })).toBeVisible();
  });

  test('sends the baseline security headers', async ({ request }) => {
    const res = await request.get('/');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});
