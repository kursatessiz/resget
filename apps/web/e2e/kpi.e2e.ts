import { test, expect } from '@playwright/test';
import type { PlatformAdminDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

test.describe('Platform funnels and KPIs', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the super admin opens the KPI board with its tiles, funnels and districts and changes the period', async ({
    page,
  }) => {
    let platform = await bff<PlatformAdminDTO>(page.request, 'admin/platform');
    if (!platform.tenant) {
      platform = await bff<PlatformAdminDTO>(page.request, 'admin/platform/setup', {
        method: 'POST',
        data: {
          name: 'Platform',
          countryCode: 'TR',
          currency: 'TRY',
          timezone: 'Europe/Istanbul',
          defaultLocale: 'tr',
        },
      });
    }
    const platformId = platform.tenant!.id;
    await bff(page.request, 'admin/features/marketing_platform', { method: 'PUT', data: { enabled: true } });
    try {
      // Off by default: the board does not exist until it is switched on for the platform tenant.
      const off = await page.goto('/pazarlama/huniler');
      expect(off?.status()).toBe(404);
      await bff(page.request, `admin/restaurants/${platformId}/features/kpi_dashboard`, {
        method: 'PUT',
        data: { enabled: true },
      });

      await page.goto('/pazarlama');
      await page.getByRole('complementary').getByRole('link', { name: 'Huniler ve KPI' }).click();
      await expect(page).toHaveURL(/\/pazarlama\/huniler$/);
      await expect(page.getByRole('heading', { name: 'Huniler ve KPI', level: 1 })).toBeVisible();
      await expect(page.locator('[data-kpi="perDay"]')).toBeVisible();
      await expect(page.getByRole('img', { name: /En yüksek gün/ })).toBeVisible();
      const qr = page.getByRole('region', { name: 'Masa QR hunisi' });
      await expect(qr.locator('[data-step="VIEWED_MENU"]')).toContainText('Menüyü açan oturum');
      const restaurants = page.getByRole('region', { name: 'Restoran hunisi' });
      await expect(restaurants.locator('[data-step="signups"]')).toContainText('Kayıt olan restoran');
      await expect(page.getByRole('region', { name: 'Kanallara göre sipariş' })).toContainText('Masa QR');
      await expect(page.getByRole('region', { name: 'İlçeler' })).toBeVisible();

      const period = page.getByLabel('Dönem');
      await period.selectOption('7');
      await expect(period).toHaveValue('7');
      await expect(page.locator('[data-kpi="orders"]')).toBeVisible();
    } finally {
      await bff(page.request, `admin/restaurants/${platformId}/features/kpi_dashboard`, {
        method: 'PUT',
        data: { enabled: null },
      });
      await bff(page.request, 'admin/features/marketing_platform', { method: 'PUT', data: { enabled: null } });
    }
  });
});
