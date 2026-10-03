import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';

const OTP = process.env.OTP_TEST_CODE ?? '482915';

test.describe('Sign-in and the panel shell', () => {
  test('the owner signs in with phone and code, lands in the panel and signs out', async ({ page }) => {
    await page.goto('/giris');
    await page.getByLabel('Telefon numarası').fill(SEED.ownerPhone);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    // One membership: straight into the restaurant.
    await expect(page).toHaveURL(new RegExp(`/panel/${SEED.restaurantSlug}$`), { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Özet');
    await expect(page.getByRole('link', { name: 'Siparişler', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sevk', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ödeme ve yemek kartları' })).toBeVisible();
    // The session is cookie based: a fresh navigation keeps the user signed in.
    await page.goto(`/panel/${SEED.restaurantSlug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Özet');
    await page.getByRole('button', { name: 'Çıkış yap' }).click();
    await expect(page).toHaveURL(/\/giris$/);
    await page.goto('/panel');
    await expect(page).toHaveURL(/\/giris\?next=/);
  });

  test('a guest without a restaurant sees the invitation hint, and the courier sees only their screens', async ({
    page,
  }) => {
    await page.goto('/giris');
    await page.getByLabel('Telefon numarası').fill(SEED.guestPhone);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await expect(page.getByText('Bu numaraya bağlı bir işletme yok')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Çıkış yap' }).click();

    await page.goto('/giris');
    await page.getByLabel('Telefon numarası').fill(SEED.courierPhone);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await expect(page).toHaveURL(new RegExp(`/panel/${SEED.restaurantSlug}$`), { timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Siparişler', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sevk', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ayarlar', exact: true })).toHaveCount(0);
  });
});
