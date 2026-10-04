import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant (PRO trial) for its own ad accounts. */
const OWNER_PHONE = '05320000019';

test.describe('Ad integrations', () => {
  test('the owner connects a Meta account, turns enhanced matching on, pulls spend and disconnects', async ({
    page,
    browser,
  }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Reklam');
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
        name: `PW Reklam ${suffix}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 26', city: 'Istanbul', district: 'Kadikoy' },
      },
    });

    await page.goto(`/panel/${restaurant.slug}/entegrasyon`);
    await expect(page.getByRole('heading', { name: 'Reklam hesapları' })).toHaveCount(0);
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/ad_integrations`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/entegrasyon`);
    await expect(page.getByRole('heading', { name: 'Reklam hesapları' })).toBeVisible();
    const meta = page.getByRole('region', { name: 'Meta (Facebook ve Instagram)' });
    await expect(meta).toContainText('Bağlı değil');
    await meta.getByLabel('Piksel kimliği').fill('123456789');
    await meta.getByLabel('Erişim jetonu').fill('pw-meta-token');
    await meta.getByRole('button', { name: 'Bağla' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Hesap bağlandı.' })).toBeVisible();
    await expect(meta).toContainText('Etkin');
    await expect(meta.getByLabel('Erişim jetonu')).toHaveValue('');
    await expect(meta).toContainText('Kayıtlı. Değiştirmek için yenisini girin.');

    await meta.getByText('Gelişmiş eşleşme: telefon ve e-postayı SHA-256 özeti olarak gönder').click();
    await expect(page.getByRole('status').filter({ hasText: 'Ayarlar kaydedildi.' })).toBeVisible();

    const perf = page.getByRole('region', { name: 'Reklam performansı' });
    await expect(perf).toContainText('Bu dönemde harcama veya reklamdan gelen dönüşüm yok.');
    await perf.getByRole('button', { name: 'Harcamayı şimdi çek' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Harcama güncellendi (7 satır).' })).toBeVisible();
    await expect(perf.locator('[data-ads-row="META"]')).toBeVisible();

    await meta.getByRole('button', { name: 'Bağlantıyı kaldır' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Bağlantı kaldırıldı.' })).toBeVisible();
    await expect(meta).toContainText('Bağlı değil');
  });
});
