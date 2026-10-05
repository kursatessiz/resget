import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { PlatformAdminDTO, SendLimitDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

/** The platform tenant, set up once; tolerates another scenario setting it up at the same moment. */
async function platformTenantId(request: Parameters<typeof bff>[0]): Promise<string> {
  const current = await bff<PlatformAdminDTO>(request, 'admin/platform');
  if (current.tenant) return current.tenant.id;
  try {
    const created = await bff<PlatformAdminDTO>(request, 'admin/platform/setup', {
      method: 'POST',
      data: {
        name: 'Platform',
        countryCode: SIGNUP_COUNTRIES[0].code,
        currency: SIGNUP_COUNTRIES[0].currency,
        timezone: SIGNUP_COUNTRIES[0].timezone,
        defaultLocale: SIGNUP_COUNTRIES[0].locale,
      },
    });
    if (created.tenant) return created.tenant.id;
  } catch {
    // Set up by a parallel scenario in the meantime.
  }
  const again = await bff<PlatformAdminDTO>(request, 'admin/platform');
  if (!again.tenant) throw new Error('platform tenant missing');
  return again.tenant.id;
}

test.describe('Send limits and the audit log', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the console sets the platform sending limits and reads the trail in the audit log', async ({ page }) => {
    const tenantId = await platformTenantId(page.request);
    try {
      await page.goto('/admin/pazarlama');
      const card = page.getByRole('region', { name: 'Gönderim sınırları' });
      await card.getByLabel('Kampanya başına en fazla alıcı').fill('500');
      await card.getByLabel('Son 24 saatte en fazla alıcı').fill('2000');
      await card.getByRole('button', { name: 'Sınırları kaydet' }).click();
      await expect(card.getByRole('status')).toHaveText('Sınırlar kaydedildi.');
      const saved = await bff<SendLimitDTO>(page.request, `admin/send-limits/${tenantId}`);
      expect(saved).toMatchObject({ maxPerCampaign: 500, maxPerDay: 2000 });

      await bff(page.request, 'admin/features/audit_viewer', { method: 'PUT', data: { enabled: true } });
      await page.goto('/admin');
      await page.getByRole('complementary').getByRole('link', { name: 'Denetim kayıtları' }).click();
      await expect(page).toHaveURL(/\/admin\/denetim$/);
      await expect(page.getByRole('heading', { name: 'Denetim kayıtları', level: 1 })).toBeVisible();
      const filters = page.getByRole('region', { name: 'Filtreler' });
      await filters.getByLabel('İşlem öneki (ör. campaign.)').fill('send_limit.');
      await filters.getByRole('button', { name: 'Uygula' }).click();
      const results = page.getByRole('region', { name: 'Sonuçlar' });
      await expect(results.locator('[data-audit-action="send_limit.update"]').first()).toBeVisible();
      await expect(results.locator('[data-audit-action]').first()).toContainText('maxPerCampaign');

      await filters.getByRole('button', { name: 'Platform gönderimleri' }).click();
      await expect(filters.getByLabel('İşletme adresi (slug)')).toHaveValue('platform');
      await expect(results).toBeVisible();
    } finally {
      await bff(page.request, `admin/send-limits/${tenantId}`, {
        method: 'PUT',
        data: { maxPerCampaign: null, maxPerDay: null },
      });
      await bff(page.request, 'admin/features/audit_viewer', { method: 'PUT', data: { enabled: null } });
    }
  });
});
