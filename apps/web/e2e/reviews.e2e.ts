import { test, expect } from '@playwright/test';
import { SIGNUP_COUNTRIES } from '@resget/shared';
import type { OrderDetailDTO, RestaurantCreatedDTO, RestaurantSettingsDTO } from '@resget/shared';
import { ADMIN_STATE, bff } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario opens its own restaurant so its switch touches no other test. */
const OWNER_PHONE = '05320000036';

test.describe('Public reviews', () => {
  test('a review shows on the restaurant page, the customer edits it, the owner answers and the platform takes it down', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Yorum');
    await page.getByLabel('Telefon numarası').fill(OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    const country = SIGNUP_COUNTRIES[0];
    const restaurant = await bff<RestaurantCreatedDTO>(page.request, 'restaurants', {
      method: 'POST',
      data: {
        name: `PW Yorum ${Date.now().toString(36)}`,
        countryCode: country.code,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.locale,
        branch: { addressLine: 'Moda Cad. No 63', city: 'Istanbul', district: 'Kadikoy' },
      },
    });
    const settings = await bff<RestaurantSettingsDTO>(page.request, `restaurants/${restaurant.id}`);
    const category = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/categories`, {
      method: 'POST',
      data: { name: 'Corbalar' },
    });
    const item = await bff<{ id: string }>(page.request, `restaurants/${restaurant.id}/menu/items`, {
      method: 'POST',
      data: { categoryId: category.id, name: 'Mercimek', priceMinor: 9000, vatRateBps: 1000 },
    });
    const order = await bff<OrderDetailDTO>(page.request, `restaurants/${restaurant.id}/orders`, {
      method: 'POST',
      data: {
        branchId: settings.branches[0].id,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: item.id, quantity: 1 }],
        customer: { fullName: 'Ayse Yilmaz', phone: `05326${String(Date.now()).slice(-6)}` },
      },
    });
    for (const step of [{ to: 'ACCEPTED', prepMinutes: 5 }, { to: 'READY' }, { to: 'PICKED_UP' }]) {
      await bff(page.request, `restaurants/${restaurant.id}/orders/${order.id}/transition`, {
        method: 'POST',
        data: step,
      });
    }
    const token = order.trackingUrl.split('/t/')[1];

    const admin = await browser.newContext({ storageState: ADMIN_STATE, locale: 'tr-TR' });
    const consolePage = await admin.newPage();
    await bff(consolePage.request, `admin/restaurants/${restaurant.id}/features/public_reviews`, {
      method: 'PUT',
      data: { enabled: true },
    });

    // The customer rates, then edits within the day.
    const guestContext = await browser.newContext({ locale: 'tr-TR' });
    const guest = await guestContext.newPage();
    await bff(guest.request, `public/orders/${token}/rating`, {
      method: 'POST',
      data: { score: 3, comment: 'Biraz soguktu, beni 0532 111 22 33 arayin' },
    });
    await guest.goto(`/t/${token}`);
    const review = guest.locator('[data-tracking-review]');
    await expect(review).toContainText('Değerlendirmenizi');
    await review.getByRole('button', { name: 'Değerlendirmeyi düzenle' }).click();
    const form = guest.getByRole('form', { name: 'Değerlendirmeyi düzenle' });
    await form.getByRole('radio').nth(3).check();
    await form.getByRole('textbox').fill('Corba sicakti ama servis yavasti. Tel 0532 111 22 33');
    await form.getByRole('button', { name: 'Kaydet' }).click();
    await expect(guest.locator('[data-tracking-review]')).toContainText('Değerlendirmeniz güncellendi.');

    // The restaurant page shows it with a short name and the phone masked.
    await guest.goto(`/${restaurant.slug}`);
    const reviews = guest.getByRole('region', { name: 'Değerlendirmeler' });
    await expect(reviews).toContainText('Ayse Y.');
    await expect(reviews).toContainText('Corba sicakti ama servis yavasti.');
    await expect(reviews).not.toContainText('0532');
    await expect(reviews).toContainText('düzenlendi');

    // The owner answers in public and reports it.
    await page.goto(`/panel/${restaurant.slug}/yorumlar`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Yorumlar');
    const item1 = page.locator('[data-panel-review]').first();
    await item1.getByLabel('Yanıtınız').fill('Geri bildiriminiz icin tesekkurler, hizlanacagiz.');
    await item1.getByRole('button', { name: 'Yanıtı yayınla' }).click();
    await expect(item1.locator('[data-panel-reply]')).toContainText('hizlanacagiz');
    await item1.getByRole('button', { name: 'Platforma bildir' }).click();
    await item1.getByLabel('Neden').selectOption('PERSONAL_DATA');
    await item1.getByRole('button', { name: 'Bildir' }).click();
    await expect(item1).toContainText('Platforma bildirildi, inceleniyor.');

    await guest.reload();
    await expect(guest.locator('[data-review-reply]')).toContainText('hizlanacagiz');

    // The platform takes it down; the restaurant page no longer lists it.
    await consolePage.goto('/admin/yorumlar');
    await expect(consolePage.getByRole('heading', { level: 1 })).toHaveText('Yorum moderasyonu');
    const reported = consolePage.getByRole('region', { name: restaurant.name });
    await expect(reported).toContainText('Bildirim: Kişisel bilgi içeriyor');
    await reported.getByRole('button', { name: 'Yayından kaldır' }).click();
    await expect(consolePage.getByRole('status')).toHaveText('Karar kaydedildi.');
    await guest.reload();
    await expect(guest.getByRole('region', { name: 'Değerlendirmeler' })).toContainText('Henüz değerlendirme yok.');
    await page.reload();
    await expect(page.locator('[data-panel-review]').first()).toContainText('Platform bu yorumu yayından kaldırdı.');

    await guestContext.close();
    await admin.close();
  });
});
