import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO, SocialAccountDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its switches touch no other test. */
const OWNER_PHONE = '05320000025';

test.describe('Social publishing', () => {
  test('the owner writes a post, sees the Instagram image rule and publishes to the page', async ({
    page,
    browser,
  }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Sosyal');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Sosyal ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 24', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const adminPage = await admin.newPage();
    for (const key of ['integration_hub', 'social_publishing']) {
      await bff(adminPage.request, `admin/restaurants/${restaurant.id}/features/${key}`, {
        method: 'PUT',
        data: { enabled: true },
      });
    }
    await admin.close();

    // Connect through the MOCK consent round trip and put both accounts in use.
    await page.goto(`/panel/${restaurant.slug}/entegrasyon`);
    await page
      .getByRole('region', { name: 'Sosyal hesaplar' })
      .getByRole('button', { name: 'Meta ile bağlan' })
      .click();
    await page.waitForURL(new RegExp(`/panel/${restaurant.slug}/entegrasyon\\?meta=connected$`));
    const accounts = await bff<SocialAccountDTO[]>(page.request, `restaurants/${restaurant.id}/social/accounts`);
    for (const account of accounts) {
      await bff(page.request, `restaurants/${restaurant.id}/social/accounts/${account.id}`, {
        method: 'PATCH',
        data: { enabled: true },
      });
    }

    await page.goto(`/panel/${restaurant.slug}/sosyal`);
    await expect(page.getByRole('heading', { level: 1, name: 'Sosyal yayın' })).toBeVisible();
    const composer = page.getByRole('region', { name: 'Yeni gönderi' });
    await composer.getByRole('textbox', { name: /^Metin/ }).fill('Hafta sonu yeni menu');
    await composer.locator('[data-post-account="mock-ig-1"]').getByRole('checkbox').check();
    await expect(composer.locator('[data-post-problem="INSTAGRAM_NEEDS_IMAGE"]')).toBeVisible();
    await expect(composer.getByRole('button', { name: 'Şimdi yayımla' })).toBeDisabled();

    await composer.locator('[data-post-account="mock-ig-1"]').getByRole('checkbox').uncheck();
    await composer.locator('[data-post-account="mock-page-1"]').getByRole('checkbox').check();
    await composer.getByRole('button', { name: 'Şimdi yayımla' }).click();

    const list = page.getByRole('region', { name: 'Gönderiler' });
    const post = list.locator('[data-post]').first();
    await expect(post).toContainText('Hafta sonu yeni menu');
    await expect(post).toContainText('Yayımlandı');
    await expect(post).toContainText('Deneme Sayfasi');
  });
});
