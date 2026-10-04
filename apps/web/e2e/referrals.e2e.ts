import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so no other scenario's coupon switch can interfere. */
const OWNER_PHONE = '05320000020';

test.describe('Customer referrals', () => {
  test('the owner sets up the programme, a customer takes a personal code and the invite link fills the coupon field', async ({
    page,
    browser,
  }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Tavsiye');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Tavsiye ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 30', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const category = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/categories`, {
      method: 'POST',
      data: { name: 'Ana yemekler' },
    });
    await bff(page.request, `restaurants/${restaurant.id}/menu/items`, {
      method: 'POST',
      data: { categoryId: category.id, name: 'Kuru fasulye', priceMinor: 25000, vatRateBps: 1000 },
    });
    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    for (const key of ['coupons', 'referrals']) {
      await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/${key}`, {
        method: 'PUT',
        data: { enabled: true },
      });
    }
    await admin.close();

    await page.goto(`/panel/${restaurant.slug}/kuponlar`);
    const card = page.getByRole('region', { name: 'Tavsiye programı' });
    await card.getByLabel('Program açık').check();
    await card.getByLabel('İndirim yüzdesi').fill('10');
    await card.getByLabel('Davet edene ödül kuponu tutarı').fill('25');
    await card.getByRole('button', { name: 'Kaydet' }).click();
    await expect(card.getByRole('status')).toHaveText('Tavsiye programı kaydedildi.');
    await expect(card.locator('[data-referral-stats]')).toContainText('Paylaşılan kod: 0');

    // The owner orders from the page like any customer, which makes them someone who can invite.
    const items = await bff<{ categories: { items: { id: string }[] }[] }>(
      page.request,
      `public/restaurants/${restaurant.slug}/menu`,
    );
    await bff(page.request, `public/restaurants/${restaurant.slug}/orders`, {
      method: 'POST',
      data: {
        fulfillment: 'PICKUP',
        items: [{ menuItemId: items.categories[0].items[0].id, quantity: 1 }],
        customer: { fullName: 'PW Tavsiye', phone: OWNER_PHONE },
        payment: { method: 'CASH_ON_DELIVERY' },
      },
    });

    await page.goto('/hesabim');
    const invite = page.getByRole('region', { name: 'Arkadaşını davet et' });
    const entry = invite.locator(`[data-referral="${restaurant.slug}"]`);
    await expect(entry).toContainText('Arkadaşınıza ilk siparişinde yüzde 10 indirim');
    await entry.getByRole('button', { name: 'Kodumu al' }).click();
    await expect(entry).toContainText(/Kodunuz: R[2-9A-Z]{7}/);
    const link = await entry.getByRole('textbox', { name: 'Paylaşım bağlantısı' }).inputValue();
    expect(link).toMatch(new RegExp(`/${restaurant.slug}\\?kod=R[2-9A-Z]{7}$`));
    const code = new URL(link).searchParams.get('kod');

    // A friend opening the link finds the code already in the coupon field.
    await page.goto(link);
    await page.getByRole('button', { name: 'Ekle: Kuru fasulye' }).click();
    await expect(page.getByLabel('Kupon kodu')).toHaveValue(code ?? '');
    await expect(page.getByText('Davet kodu kupon alanına eklendi.')).toBeVisible();
  });
});
