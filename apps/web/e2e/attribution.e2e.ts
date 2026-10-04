import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so the banner never covers another scenario's page. */
const OWNER_PHONE = '05320000013';

test.describe('Visit measurement', () => {
  test('nothing is measured before a KVKK yes; the visit then shows in the attribution report', async ({
    page,
    browser,
  }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Atif');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Atif ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 14', city: 'Istanbul', district: 'Kadikoy' },
      },
    });

    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/attribution`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    const visitorCookie = async () => (await page.context().cookies()).find((c) => c.name === 'rg_vid');

    // A Turkish browser gets the KVKK banner; nothing is written before the answer.
    await page.goto(`/${restaurant.slug}?utm_source=pw-flyer&utm_medium=print`);
    const banner = page.getByRole('dialog', { name: 'Çerez tercihleri' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('KVKK');
    expect(await visitorCookie()).toBeUndefined();

    await banner.getByRole('button', { name: 'Tümünü kabul et' }).click();
    await expect(banner).toBeHidden();
    await expect.poll(async () => (await visitorCookie())?.value ?? '').toMatch(/^[a-f0-9]{32}$/);

    await page.goto(`/panel/${restaurant.slug}/atif`);
    const report = page.getByRole('region', { name: 'Atıf' });
    await expect(report.locator('[data-visits]')).toContainText('1 ölçülen ziyaret');

    // Taking the yes back deletes the visitor cookie.
    await page.goto(`/${restaurant.slug}`);
    await page.getByRole('button', { name: 'Çerez tercihleri' }).click();
    await page.getByRole('dialog', { name: 'Çerez tercihleri' }).getByRole('button', { name: 'Tümünü reddet' }).click();
    await expect.poll(async () => (await visitorCookie())?.value ?? '').toBe('');
  });
});
