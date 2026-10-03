import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { OWNER_STATE } from './support/session';

test.describe('Loyalty program', () => {
  test.use({ storageState: OWNER_STATE });

  test('the owner turns the program on, the storefront shows it, and the owner turns it off again', async ({
    page,
  }) => {
    await page.goto(`/panel/${SEED.restaurantSlug}/sadakat`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sadakat programı');
    const form = page.getByRole('form', { name: 'Kurallar' });
    await expect(form).toBeVisible();
    const toggle = form.getByLabel('Program açık');
    const wasOn = await toggle.isChecked();
    if (!wasOn) await toggle.check();
    await form.getByLabel('İlk tamamlanan siparişte hoş geldin puanı').fill('25');
    await form.getByRole('button', { name: 'Kaydet' }).click();
    await expect(page.getByRole('status')).toHaveText('Program kaydedildi.');
    await expect(page.getByText('Program açık.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Puanı olan müşteri' })).toBeVisible();

    // The signed-in owner is a customer like any other on the storefront: balance and the earn rule under the basket.
    await page.goto(`/${SEED.restaurantSlug}`);
    await page
      .locator(`[data-menu-item="${SEED.firstMenuItem}"]`)
      .getByRole('button', { name: `Ekle: ${SEED.firstMenuItem}` })
      .click();
    await expect(page.locator('[data-loyalty]')).toContainText(/Puanınız: \d+/);
    await expect(page.locator('[data-loyalty]')).toContainText(/puan kazanırsınız/);

    // Back to the seeded state: the program off.
    await page.goto(`/panel/${SEED.restaurantSlug}/sadakat`);
    const again = page.getByRole('form', { name: 'Kurallar' });
    await again.getByLabel('Program açık').uncheck();
    await again.getByRole('button', { name: 'Kaydet' }).click();
    await expect(page.getByRole('status')).toHaveText('Program kaydedildi.');
    await expect(page.getByText(/^Program kapalı\./)).toBeVisible();
  });
});
