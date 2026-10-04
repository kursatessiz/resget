import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant for its own sending domain. */
const OWNER_PHONE = '05320000015';

test.describe('Email channel', () => {
  test('the owner adds a sending domain, checks its DNS, sends a test and lists an address not to mail', async ({
    page,
    browser,
  }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Eposta');
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
        name: `PW Eposta ${suffix}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 18', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/email_channel`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/entegrasyon`);
    const card = page.getByRole('region', { name: 'E-posta gönderici' });
    const domain = `pw-${suffix}.verified.test`;
    await card.getByLabel('Alan adı (ör. ornekrestoran.com)').fill(domain);
    await card.getByLabel('Gönderen adı').fill('PW Eposta');
    await card.getByRole('button', { name: 'Alan adı ekle' }).click();
    const row = card.locator(`[data-email-domain="${domain}"]`);
    await expect(row).toContainText('Doğrulama bekliyor');
    await expect(row.locator('[data-dns-record="DKIM"]')).toHaveCount(3);
    await row.getByRole('button', { name: 'DNS kayıtlarını denetle' }).click();
    await expect(row).toContainText('Doğrulandı');

    await card.getByLabel('Deneme e-postasının gideceği adres').fill('pw.deneme@ornek.test');
    await card.getByRole('button', { name: 'Deneme e-postası gönder' }).click();
    await expect(card.getByRole('status')).toHaveText('Deneme e-postası gönderildi.');

    await card.getByLabel('E-posta adresi').fill('istemiyor@ornek.test');
    await card.getByRole('button', { name: 'Listeye ekle' }).click();
    await expect(card).toContainText('istemiyor@ornek.test');
  });
});
