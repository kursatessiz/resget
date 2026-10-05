import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO, RestaurantSettingsDTO, TableDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its switch touches no other test. */
const OWNER_PHONE = '05320000035';

test.describe('Open tab', () => {
  test('a guest puts orders on the tab, the table splits the bill and the waiter collects it in shares', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Hesap');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Hesap ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 52', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const settings = await bff<RestaurantSettingsDTO>(page.request, `restaurants/${restaurant.id}`);
    const category = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/categories`, {
      method: 'POST',
      data: { name: 'Ana yemek' },
    });
    for (const [name, priceMinor] of [
      ['Adana kebap', 30000],
      ['Ayran', 5000],
    ] as const) {
      await bff(page.request, `restaurants/${restaurant.id}/menu/items`, {
        method: 'POST',
        data: { categoryId: category.id, name, priceMinor, vatRateBps: 1000 },
      });
    }
    const table = await bff<TableDTO>(page.request, `restaurants/${restaurant.id}/tables`, {
      method: 'POST',
      data: { branchId: settings.branches[0].id, label: 'Bahce 3' },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    await bff((await admin.newPage()).request, `admin/restaurants/${restaurant.id}/features/table_tabs`, {
      method: 'PUT',
      data: { enabled: true },
    });
    await admin.close();

    // The guest orders at the table and puts it on the tab.
    const guestContext = await browser.newContext({ locale: 'tr-TR' });
    const guest = await guestContext.newPage();
    await guest.goto(new URL(table.qrUrl).pathname);
    await guest.getByRole('button', { name: 'Ekle: Adana kebap' }).click();
    await guest.getByRole('button', { name: 'Ekle: Ayran' }).click();
    await guest.getByLabel('Açık hesaba yaz (masada veya kasada ödenir)').check();
    await guest.getByRole('button', { name: 'Siparişi ver' }).click();
    await guest.waitForURL(/\/hesap\//, { timeout: 20_000 });
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText('Masa Bahce 3 hesabı');
    await expect(guest.locator('[data-bill-line]')).toHaveCount(2);
    const total = await guest.locator('[data-bill-due]').textContent();
    expect(total).toContain('350');

    // The table splits it equally between two.
    const split = guest.getByRole('region', { name: 'Hesabı böl' });
    await expect(split.locator('[data-split-share="1"]')).toContainText('175');
    await expect(split.locator('[data-split-share="2"]')).toContainText('175');
    await split.getByLabel('Ürüne göre').check();
    await split.getByLabel('Adana kebap: Kişi 1').check();
    await split.getByLabel('Ayran: Kişi 2').check();
    await expect(split.locator('[data-split-share="1"]')).toContainText('300');
    await expect(split.locator('[data-split-share="2"]')).toContainText('50');

    // Back at the menu the table sees its running tab.
    await guest.goto(new URL(table.qrUrl).pathname);
    await expect(guest.locator('[data-open-tab]')).toContainText('Bu masanın açık hesabı');
    await guestContext.close();

    // The waiter collects it in two shares from the panel and closes it.
    await page.goto(`/panel/${restaurant.slug}/hesaplar`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Açık hesaplar');
    const row = page.locator('[data-tab-row="Bahce 3"]');
    await expect(row).toContainText('1 sipariş');
    await row.getByRole('button', { name: 'Hesabı aç' }).click();
    const panelSplit = page.getByRole('region', { name: 'Hesabı böl' });
    await panelSplit.locator('[data-split-share="1"]').getByRole('button', { name: 'Bu payı tahsil et' }).click();
    const collect = page.getByRole('region', { name: 'Tahsilat' });
    await expect(collect.getByLabel('Tutar (minör birim)')).toHaveValue('17500');
    await collect.getByRole('button', { name: 'Tahsil et' }).click();
    await expect(page.getByRole('status')).toHaveText('Tahsil edildi.');
    await expect(page.locator('[data-panel-bill-summary]')).toContainText('175');
    await collect.getByRole('button', { name: 'Kalanın tamamı' }).click();
    await collect.getByRole('button', { name: 'Tahsil et' }).click();
    await expect(page.getByRole('status')).toHaveText('Tahsil edildi.');
    await collect.getByRole('button', { name: 'Hesabı kapat' }).click();
    await expect(page.getByRole('status')).toHaveText('Hesap kapandı.');

    await page.getByRole('button', { name: 'Tüm açık hesaplar' }).click();
    await expect(page.getByText('Açık hesap yok.')).toBeVisible();
    await page.goto(`/panel/${restaurant.slug}/siparisler`);
    await expect(page.locator('[data-order-tab]').first()).toHaveText('Açık hesap');
  });
});
