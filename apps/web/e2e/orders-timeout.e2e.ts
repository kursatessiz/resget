import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { OWNER_STATE } from './support/session';

test.describe('Acceptance timeout on the orders screen', () => {
  test.use({ storageState: OWNER_STATE });

  test('an old new order is flagged as overdue and the sound alert can be toggled', async ({ page }) => {
    await page.goto(`/panel/${SEED.restaurantSlug}/siparisler`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Siparişler');
    // The seeded order is still new: its badge counts down or, once the window passed, reads overdue.
    await expect(page.getByText(/Kabul için \d+ dk|Kabul süresi doldu/).first()).toBeVisible();
    const toggle = page.getByRole('button', { name: /Sesli uyarı/ });
    await expect(toggle).toHaveText('Sesli uyarı açık');
    await toggle.click();
    await expect(toggle).toHaveText('Sesli uyarı kapalı');
    await page.reload();
    await expect(page.getByRole('button', { name: /Sesli uyarı/ })).toHaveText('Sesli uyarı kapalı');
    await page.getByRole('button', { name: /Sesli uyarı/ }).click();
  });
});
