import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant (PRO trial) so its switch touches no other test. */
const OWNER_PHONE = '05320000021';

test.describe('Churn risk', () => {
  test('the panel page is behind its switch and shows the classes; the console lists restaurant health', async ({
    page,
    browser,
  }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Kayip');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Kayip ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 24', city: 'Istanbul', district: 'Kadikoy' },
      },
    });

    const off = await page.goto(`/panel/${restaurant.slug}/kayip-riski`);
    expect(off?.status()).toBe(404);

    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    try {
      await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/churn_signals`, {
        method: 'PUT',
        data: { enabled: true },
      });
      await page.goto(`/panel/${restaurant.slug}`);
      await page.getByRole('navigation').getByRole('link', { name: 'Kayıp riski' }).click();
      await expect(page).toHaveURL(new RegExp(`/panel/${restaurant.slug}/kayip-riski$`));
      const summary = page.getByRole('region', { name: 'Kayıp riski' });
      await expect(summary.locator('[data-churn-count="AT_RISK"]')).toContainText('Riskte');
      await expect(summary.locator('[data-churn-count="AT_RISK"]')).toContainText('0');
      const list = page.getByRole('region', { name: 'Geri kazanılacak müşteriler' });
      await expect(list).toContainText('Bu sınıfta müşteri yok.');
      await list.getByRole('button', { name: 'Kayıp' }).click();
      await expect(list).toContainText('Bu sınıfta müşteri yok.');

      // Console: the global switch opens the restaurant health page.
      await bff(consolePage.request, 'admin/features/restaurant_health', { method: 'PUT', data: { enabled: true } });
      await consolePage.goto('/admin');
      await consolePage.getByRole('complementary').getByRole('link', { name: 'Restoran sağlığı' }).click();
      await expect(consolePage).toHaveURL(/\/admin\/saglik$/);
      await expect(consolePage.getByRole('heading', { name: 'Restoran sağlığı', level: 1 })).toBeVisible();
      await expect(consolePage.locator('[data-health-counts]')).toContainText('İncelenen restoran');
    } finally {
      await bff(consolePage.request, 'admin/features/restaurant_health', { method: 'PUT', data: { enabled: null } });
      await admin.close();
    }
  });
});
