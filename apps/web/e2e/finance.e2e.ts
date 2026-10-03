import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { OWNER_STATE } from './support/session';

test.describe('Finance: commission invoices', () => {
  test.use({ storageState: OWNER_STATE });

  test('the owner opens the finance page and sees the accrual, the card choice and the invoice list', async ({
    page,
  }) => {
    await page.goto(`/panel/${SEED.restaurantSlug}/finans`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Finans ve komisyon faturaları');
    await expect(page.getByRole('heading', { name: 'Bu ay biriken komisyon' })).toBeVisible();
    await expect(page.getByText(/sipariş, /)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Otomatik tahsilat kartı' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Faturalar', exact: true })).toBeVisible();
  });
});
