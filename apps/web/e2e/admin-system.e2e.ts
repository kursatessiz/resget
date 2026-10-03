import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { signIn } from './support/session';

test.describe('Console system page', () => {
  test('the super admin sees components, jobs, providers and the activity counters', async ({ page }) => {
    await signIn(page, SEED.superAdminPhone);
    await page.goto('/admin/sistem');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sistem sağlığı');
    const components = page.getByRole('region', { name: 'Bileşenler' });
    await expect(components).toContainText('Veritabanı');
    await expect(components).toContainText('Çalışıyor');
    await expect(page.getByRole('region', { name: 'Sağlayıcılar' })).toContainText('SMS: MOCK');
    await expect(page.getByRole('region', { name: 'Son 24 saat' })).toContainText('Aktif restoran');
  });
});
