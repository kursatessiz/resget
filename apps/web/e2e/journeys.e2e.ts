import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant (PRO trial) for its own flows. */
const OWNER_PHONE = '05320000018';

test.describe('Automated flows', () => {
  test('the owner writes a review request flow from the suggested text, switches it on, then pauses it', async ({
    page,
    browser,
  }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Akis');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const suffix = Date.now().toString(36);
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Akis ${suffix}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 24', city: 'Istanbul', district: 'Kadikoy' },
      },
    });

    const off = await page.goto(`/panel/${restaurant.slug}/akislar`);
    expect(off?.status()).toBe(404);
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/journeys`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/akislar`);
    await expect(page.getByRole('heading', { name: 'Otomatik akışlar', level: 1 })).toBeVisible();
    const form = page.getByRole('region', { name: 'Yeni akış' });
    await form.getByLabel('Akış adı').fill('PW Degerlendirme');
    await form.getByLabel('Tetikleyici').selectOption('REVIEW_REQUEST');
    await expect(form.getByLabel('Gecikme (saat)')).toHaveValue('3');
    await form.getByRole('button', { name: 'Önerilen metni kullan' }).click();
    await expect(form.getByRole('textbox', { name: /^Mesaj/ })).toHaveValue(/\{link\}/);
    await form.getByRole('button', { name: 'Akışı kaydet' }).click();
    await expect(page.getByText('Akış kaydedildi. Açtığınızda çalışmaya başlar.')).toBeVisible();

    const row = page.getByRole('region', { name: 'Akışlar' }).getByRole('listitem', { name: 'PW Degerlendirme' });
    await expect(row).toContainText('Duraklatıldı');
    await expect(row).toContainText('Değerlendirme isteği');
    await expect(row).toContainText('3 saat sonra');
    await row.getByRole('button', { name: 'Aç' }).click();
    await expect(page.getByText('Akış açıldı.')).toBeVisible();
    await expect(row).toContainText('Açık');
    await row.getByRole('button', { name: 'Duraklat' }).click();
    await expect(page.getByText('Akış duraklatıldı.')).toBeVisible();
    await expect(row).toContainText('Duraklatıldı');
  });
});
