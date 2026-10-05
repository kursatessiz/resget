import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES, localClock } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its switch touches no other test. */
const OWNER_PHONE = '05320000028';
const hhmm = (minutes: number) =>
  `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

test.describe('Menu dayparts', () => {
  test('the owner limits a section to set hours and guests cannot order it outside them', async ({ page, browser }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Ogun');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Ogun ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 36', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const category = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/categories`, {
      method: 'POST',
      data: { name: 'Kahvalti' },
    });
    await bff(page.request, `restaurants/${restaurant.id}/menu/items`, {
      method: 'POST',
      data: { categoryId: category.id, name: 'Menemen', priceMinor: 12000, vatRateBps: 1000 },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    await bff((await admin.newPage()).request, `admin/restaurants/${restaurant.id}/features/menu_dayparts`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    // A two-hour window starting at least two hours from now, in the restaurant's zone.
    const start = Math.ceil((localClock(new Date(), country.timezone).minutes + 120) / 60) * 60;
    await page.goto(`/panel/${restaurant.slug}/menu`);
    const section = page.getByRole('region', { name: 'Kahvalti' });
    await section.getByRole('button', { name: 'Servis saatleri' }).click();
    const editor = section.getByRole('form', { name: 'Servis saatleri' });
    await editor.getByLabel('Yalnızca belirli saatlerde').check();
    await editor.getByLabel('Başlangıç').fill(hhmm(start));
    await editor.getByLabel('Bitiş').fill(hhmm(start + 120));
    await editor.getByRole('button', { name: 'Kaydet' }).click();
    await expect(section).toContainText(`${hhmm(start)} - ${hhmm(start + 120)}`);

    await page.goto(`/${restaurant.slug}`);
    const guestSection = page.getByRole('region', { name: 'Kahvalti' });
    await expect(guestSection.locator('[data-daypart-closed]')).toContainText(hhmm(start));
    await expect(guestSection.getByRole('button', { name: 'Ekle: Menemen' })).toHaveCount(0);
  });
});
