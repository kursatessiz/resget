import { test, expect } from '@playwright/test';

test.describe('Language selection', () => {
  test.describe('English browser', () => {
    test.use({ locale: 'en-US' });

    test('an English browser gets the English landing page', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('link', { name: 'Register your restaurant' })).toBeVisible();
    });
  });

  test('a Turkish browser gets the Turkish landing page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.getByRole('link', { name: 'İşletmeni kaydet' })).toBeVisible();
  });
});
