import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant (PRO trial) so its switch touches no other test. */
const OWNER_PHONE = '05320000022';

test.describe('AI studio', () => {
  test('the owner drafts a campaign message with AI and the chosen draft fills the form', async ({ page, browser }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Yapay Zeka');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Yapay Zeka ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 24', city: 'Istanbul', district: 'Kadikoy' },
      },
    });

    await page.goto(`/panel/${restaurant.slug}/kampanyalar`);
    await expect(page.getByRole('region', { name: 'Yapay zekayla taslak' })).toHaveCount(0);

    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/ai_studio`, {
      method: 'PUT',
      data: { enabled: true },
    });

    await page.reload();
    const assistant = page.getByRole('region', { name: 'Yapay zekayla taslak' });
    await expect(assistant).toContainText('yalnızca taslak yazar');
    await assistant.getByLabel('Mesaj ne anlatsın?').fill('Hafta sonu tatlilarda indirim; bilgi icin 0532 111 22 33');
    await assistant.getByRole('button', { name: 'Taslak üret' }).click();
    await expect(assistant.locator('[data-ai-redactions]')).toContainText('1 kişisel bilgi çıkarıldı');
    await expect(assistant.locator('[data-ai-draft]')).toHaveCount(2);
    await expect(assistant.locator('[data-ai-budget]')).toContainText('Bu ay kalan yapay zeka bütçesi');
    const firstDraft = (await assistant.locator('[data-ai-draft="0"] > span').first().textContent()) ?? '';
    await assistant.locator('[data-ai-draft="0"]').getByRole('button', { name: 'Bu taslağı kullan' }).click();
    // The body field's accessible name carries its character counter.
    await expect(page.getByRole('textbox', { name: /^Mesaj \d/ })).toHaveValue(firstDraft);

    // The console sees this month's use on the restaurant page.
    await consolePage.goto(`/admin/restoranlar/${restaurant.id}`);
    const budget = consolePage.getByRole('region', { name: 'Yapay zeka bütçesi' });
    await expect(budget.locator('[data-ai-used]')).toContainText('Bu ay kullanılan');
    await admin.close();
  });
});
