import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { signIn } from './support/session';

test.describe('Console payouts page', () => {
  test('the super admin closes the week and reads the report', async ({ page }) => {
    await signIn(page, SEED.superAdminPhone);
    await page.goto('/admin/hakedisler');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hakediş ödemeleri');
    await expect(page.getByRole('heading', { name: 'Hakediş ödemeleri', exact: true }).first()).toBeVisible();
    // The seed has no platform-collected order, so the run plans nothing and says so.
    await page.getByRole('button', { name: 'Haftayı şimdi kapat' }).click();
    await expect(page.getByRole('status')).toContainText(/ödeme planlandı/);
  });
});
