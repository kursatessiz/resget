import { test, expect } from '@playwright/test';
import type { PlatformAdminDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

test.describe('Platform marketing', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the super admin sets the platform tenant up, adds a marketing user and opens the marketing area', async ({
    page,
  }) => {
    await page.goto('/admin/pazarlama');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Platform pazarlaması');
    const before = await bff<PlatformAdminDTO>(page.request, 'admin/platform');
    if (!before.tenant) {
      const setup = page.getByRole('region', { name: 'Kurulum' });
      await setup.getByLabel('Platform adı').fill('Platform');
      await setup.getByRole('button', { name: 'Platform kiracısını oluştur' }).click();
    }
    await expect(page.getByRole('region', { name: 'Kurulum' }).getByRole('status')).toContainText(
      'Platform kiracısı hazır',
    );

    const users = page.getByRole('region', { name: 'Pazarlama kullanıcıları' });
    await users.getByLabel('Telefon').fill('05320000012');
    await users.getByLabel('Ad soyad').fill('PW Pazarlama');
    await users.getByRole('button', { name: 'Kullanıcı ekle' }).click();
    await expect(users.locator('[data-platform-user]').filter({ hasText: 'PW Pazarlama' })).toBeVisible();

    await bff(page.request, 'admin/features/marketing_platform', { method: 'PUT', data: { enabled: true } });
    try {
      await page.goto('/pazarlama');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Özet');
      const nav = page.getByRole('complementary');
      await expect(nav.getByText('Süper admin')).toBeVisible();
      await nav.getByRole('link', { name: 'Kişiler' }).click();
      await expect(page).toHaveURL(/\/pazarlama\/kisiler$/);
    } finally {
      await bff(page.request, 'admin/features/marketing_platform', { method: 'PUT', data: { enabled: null } });
    }
    await page.goto('/pazarlama');
    await expect(page.getByRole('status')).toHaveText(
      'Platform pazarlaması kapalı. Süper admin Özellik anahtarları sayfasından açar.',
    );
  });
});
