import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant (PRO trial) for its own segments. */
const OWNER_PHONE = '05320000016';

test.describe('Segments v2', () => {
  test('the owner builds an AND / OR rule, previews it, saves a static segment and targets a campaign at it', async ({
    page,
    browser,
  }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Segment');
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
        name: `PW Segment ${suffix}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 20', city: 'Istanbul', district: 'Kadikoy' },
      },
    });

    // Off by default: the screen does not exist until the console switches it on.
    const off = await page.goto(`/panel/${restaurant.slug}/segmentler`);
    expect(off?.status()).toBe(404);
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/segments_v2`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/segmentler`);
    await expect(page.getByRole('heading', { name: 'Segmentler', level: 1 })).toBeVisible();
    const builder = page.getByRole('region', { name: 'Segment kuralı' });
    await builder.getByRole('button', { name: 'Alt grup ekle' }).click();
    const nested = builder.locator('[data-segment-group="2"]');
    await expect(nested).toBeVisible();
    const nestedCondition = nested.locator('[data-segment-condition]').first();
    await nestedCondition.getByLabel('Alan').selectOption('lastOrderAt');
    await expect(nestedCondition.getByRole('spinbutton', { name: 'Gün' })).toHaveValue('30');
    await builder.getByRole('button', { name: 'Önizle' }).first().click();
    await expect(builder.getByRole('status')).toHaveText('Bu kurala şu an 0 kişi uyuyor.');
    await expect(builder).toContainText('SMS: 0 ulaşılabilir');

    await builder.getByLabel('Segment adı').fill('PW Sadik');
    await builder.getByLabel('Tür').selectOption('STATIC');
    await builder.getByRole('button', { name: 'Segmenti kaydet' }).click();
    await expect(page.getByText('Segment kaydedildi.')).toBeVisible();
    const row = page.getByRole('region', { name: 'Kayıtlı segmentler' }).getByRole('listitem', { name: 'PW Sadik' });
    await expect(row).toContainText('Statik');
    await expect(row).toContainText('0 kişi');
    await row.getByRole('button', { name: 'Anlık görüntüyü yenile' }).click();
    await expect(page.getByText('Anlık görüntü yenilendi.')).toBeVisible();

    await page.goto(`/panel/${restaurant.slug}/kampanyalar`);
    const target = page.getByLabel('Hedef segment');
    await expect(target.locator('option', { hasText: 'PW Sadik' })).toHaveCount(1);
    await target.selectOption({ label: 'PW Sadik (Statik, 0 kişi)' });
    // With a saved segment chosen, the inline filters step aside.
    await expect(page.getByText('Kime gidecek')).toBeHidden();
  });
});
