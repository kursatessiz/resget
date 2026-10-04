import { test, expect } from '@playwright/test';
import type { AdminRestaurantPageDTO } from '@resget/shared';
import { SEED } from './support/seed';
import { ADMIN_STATE, OWNER_STATE, bff } from './support/session';

test.describe('CRM pipeline', () => {
  test.use({ storageState: OWNER_STATE });

  test('the owner adds a lead, logs a call, adds a task and sees it in the open tasks', async ({ page, browser }) => {
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    const found = await bff<AdminRestaurantPageDTO>(
      consolePage.request,
      `admin/restaurants?query=${SEED.restaurantSlug}`,
    );
    const restaurantId = found.items.find((r) => r.slug === SEED.restaurantSlug)!.id;
    const setSwitch = (enabled: boolean | null) =>
      bff(consolePage.request, `admin/restaurants/${restaurantId}/features/contacts_crm`, {
        method: 'PUT',
        data: { enabled },
      });
    const name = `PW Aday ${Date.now().toString(36)}`;
    const phone = `0533${String(Date.now()).slice(-7)}`;
    try {
      await setSwitch(true);
      await page.goto(`/panel/${SEED.restaurantSlug}/satis-hatti`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Satış hattı');

      const form = page.getByRole('region', { name: 'Yeni kişi' });
      await form.getByLabel('Ad soyad').fill(name);
      await form.getByLabel('Telefon').fill(phone);
      await form.getByLabel('İşletme').fill('Moda Ofis');
      await form.getByLabel('Aşama').selectOption({ label: 'Yeni' });
      await form.getByRole('button', { name: 'Kişiyi ekle' }).click();
      await expect(page.getByRole('status')).toHaveText('Kişi eklendi.');

      const card = page.locator(`[data-contact="${name}"]`);
      await expect(card).toContainText('Moda Ofis');
      await card.getByRole('button', { name: 'Aç' }).click();
      const detail = page.getByRole('region', { name: 'Kişi kartı' });
      await detail.getByLabel('Tür').selectOption('CALL');
      await detail.getByLabel('Not', { exact: true }).fill('Toplu siparis konusuldu');
      await detail.getByRole('button', { name: 'Kaydet' }).click();
      await expect(detail.locator('[data-activity="CALL"]')).toContainText('Toplu siparis konusuldu');

      await detail.getByLabel('Görev', { exact: true }).fill('Teklif gonder');
      await detail.getByRole('button', { name: 'Görev ekle' }).click();
      await expect(
        page.getByRole('region', { name: 'Görevler' }).last().locator('[data-task="Teklif gonder"]').first(),
      ).toBeVisible();
    } finally {
      await setSwitch(null);
      await admin.close();
    }
  });
});
