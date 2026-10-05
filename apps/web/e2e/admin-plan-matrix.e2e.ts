import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its plan changes touch no other test. */
const OWNER_PHONE = '05320000034';

test.describe('Console plan matrix', () => {
  test('a new plan leaves a module out, the restaurant loses it and an off-plan exception opens it', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Plan Matrisi');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Plan Matrisi ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 24', city: 'Istanbul', district: 'Kadikoy' },
      },
    });

    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    try {
      await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/kitchen_display`, {
        method: 'PUT',
        data: { enabled: true },
      });
      const nav = page.getByRole('complementary');
      await page.goto(`/panel/${restaurant.slug}`);
      await expect(nav.getByRole('link', { name: 'Mutfak ekranı' })).toBeVisible();

      // A new plan, created in the console, starts with what the free plan carries.
      const suffix = Date.now().toString(36).toUpperCase();
      const code = `PW${suffix}`;
      const name = `PW Mini ${suffix}`;
      await consolePage.goto('/admin/planlar');
      const form = consolePage.getByRole('region', { name: 'Yeni plan' });
      await form.getByLabel('Plan kodu').fill(code);
      await form.getByLabel('Plan adı').fill(name);
      await form.getByLabel('Aylık ücret (minör birim)').fill('9900');
      await form.getByLabel('Para birimi').fill(country.currency);
      await form.getByRole('button', { name: 'Planı oluştur' }).click();

      const matrix = consolePage.getByRole('region', { name: 'Planlar ve özellikler' });
      await expect(matrix.locator(`[data-plan-column="${code}"]`)).toHaveText(name);
      const cell = matrix.locator(`[data-matrix-cell="${code}:kitchen_display"]`);
      await expect(cell).toBeChecked();
      await expect(matrix.locator(`[data-matrix-cell="${code}:campaigns"]`)).not.toBeChecked();
      await cell.uncheck();
      await matrix.getByRole('button', { name: 'Matrisi kaydet' }).click();
      await expect(matrix.locator('[data-matrix-result]')).toContainText(`${name}: 0 eklendi, 1 çıkarıldı`);

      // The restaurant moves to the new plan: the module leaves its panel.
      await consolePage.goto(`/admin/restoranlar/${restaurant.id}`);
      const card = consolePage.getByRole('region', { name: 'Plan ve plan dışı izinler' });
      await card.locator('#assign-plan').selectOption({ label: name });
      await card.getByRole('button', { name: 'Plan ata' }).click();
      await expect(card.locator(`[data-entitlement-plan="${code}"]`)).toContainText(`Geçerli plan: ${name}`);
      await page.reload();
      await expect(nav.getByRole('link', { name: 'Siparişler' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Mutfak ekranı' })).toHaveCount(0);

      // "Plan dışı açık" brings it back for this restaurant only.
      await card.locator('#entitlement-key').selectOption({ label: 'Mutfak ekranı' });
      await card.getByLabel('Not (isteğe bağlı)').fill('pilot');
      await card.getByRole('button', { name: 'Plan dışı aç' }).click();
      const grant = card.locator('[data-entitlement-grant="EXCEPTION:kitchen_display"]');
      await expect(grant).toContainText('Plan dışı açık');
      await expect(grant).toContainText('Süresiz');
      await page.reload();
      await expect(nav.getByRole('link', { name: 'Mutfak ekranı' })).toBeVisible();

      await grant.getByRole('button', { name: 'Kaldır' }).click();
      await expect(card).toContainText('Plan dışı izin yok.');
      await page.reload();
      await expect(nav.getByRole('link', { name: 'Mutfak ekranı' })).toHaveCount(0);
    } finally {
      await admin.close();
    }
  });
});
