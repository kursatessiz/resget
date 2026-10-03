import { test, expect } from '@playwright/test';

const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: this scenario creates the user and the restaurant. */
const NEW_OWNER_PHONE = '05320000008';

test.describe('Restaurant sign-up', () => {
  test('a new owner verifies their phone, creates a restaurant and lands in its panel', async ({ page }) => {
    await page.goto('/kayit');
    await page.waitForURL(/\/giris/);
    await page.getByLabel('Adınız').fill('PW Sahip');
    await page.getByLabel('Telefon numarası').fill(NEW_OWNER_PHONE);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('Doğrulama kodu').fill(OTP);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await page.waitForURL(/\/kayit/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('İşletmenizi açın');

    const name = `PW Lokanta ${Date.now().toString(36)}`;
    await page.getByLabel('İşletme adı').fill(name);
    await expect(page.getByLabel('Sipariş sayfası adresi')).toHaveValue(/^pw-lokanta-/);
    await page.getByLabel('Adres', { exact: true }).fill('Bagdat Cad. No 100');
    await page.getByLabel('İl', { exact: true }).fill('Istanbul');
    await page.getByLabel('İlçe', { exact: true }).fill('Kadikoy');
    await page.getByRole('button', { name: 'İşletmeyi oluştur' }).click();
    await page.waitForURL(/\/panel\/pw-lokanta-/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Özet');
    await expect(page.getByRole('complementary')).toContainText(name);
    await expect(page.getByRole('complementary')).toContainText('Pro plan');
  });
});
