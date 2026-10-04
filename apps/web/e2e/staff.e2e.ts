import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { OWNER_STATE } from './support/session';

const OTP = process.env.OTP_TEST_CODE ?? '482915';

test.describe('Staff invites and roles', () => {
  test.use({ storageState: OWNER_STATE });

  test('the owner invites a person who joins through the link and signs in with their own number', async ({
    page,
    browser,
  }) => {
    await page.goto(`/panel/${SEED.restaurantSlug}/personel`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Personel');

    const form = page.getByRole('region', { name: 'Davet et' });
    await form.getByLabel('Ad soyad').fill('PW Personel');
    await form.getByLabel('Telefon numarası').fill(SEED.staffPhone);
    await form.getByLabel('Rol').selectOption({ label: 'Mutfak' });
    await form.getByRole('button', { name: 'Davet oluştur' }).click();
    const pending = page.getByRole('region', { name: 'Bekleyen davetler' });
    const row = pending.locator('[data-invite-phone]').filter({ hasText: 'PW Personel' });
    await expect(row).toBeVisible();
    await expect(row.getByRole('img', { name: 'PW Personel için davet QR kodu' })).toBeVisible();
    const link = await row.getByRole('link').last().getAttribute('href');
    expect(link).toContain('/j/');

    // The invited person opens the link in their own browser.
    // A fresh browser without the owner's cookies: newContext() would otherwise inherit the configured storage state.
    const invitee = await browser.newContext({ locale: 'tr-TR', storageState: { cookies: [], origins: [] } });
    const other = await invitee.newPage();
    await other.goto(link ?? '');
    await expect(other.getByRole('heading', { level: 1 })).toHaveText('Ekibe davet');
    await expect(other.getByText(SEED.restaurantName)).toBeVisible();
    await other.getByRole('link', { name: 'Numaramı doğrula ve katıl' }).click();
    await other.getByLabel('Telefon numarası').fill(SEED.staffPhone);
    await other.getByRole('button', { name: 'Kod gönder' }).click();
    await other.getByLabel('Doğrulama kodu').fill(OTP);
    await other.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
    await other.waitForURL(new RegExp(`/panel/${SEED.restaurantSlug}`), { timeout: 15_000 });
    const nav = other.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'Siparişler', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Personel', exact: true })).toHaveCount(0);
    await invitee.close();

    // Back in the owner's panel the person is on the team; access can be switched off.
    await page.reload();
    const team = page.getByRole('region', { name: 'Ekip' });
    const member = team.locator('[data-member-phone]').filter({ hasText: 'PW Personel' });
    await expect(member).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await member.getByRole('button', { name: 'Erişimi kapat' }).click();
    await expect(member.getByText('Erişim kapalı')).toBeVisible();

    // Roles page lists the defaults and lets the owner add a custom role.
    await page.goto(`/panel/${SEED.restaurantSlug}/personel/roller`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Roller ve yetkiler');
    await expect(page.getByRole('region', { name: 'Sahip' })).toBeVisible();
    const roleName = `PW Rol ${Date.now().toString(36)}`;
    await page.getByLabel('Rol adı').first().fill(roleName);
    await page.getByRole('button', { name: 'Yeni rol' }).click();
    const role = page.getByRole('region', { name: roleName });
    await expect(role).toBeVisible();
    await role.getByLabel('Siparişleri görüntüleme').check();
    await role.getByRole('button', { name: 'Kaydet' }).click();
    await expect(role.getByText('Kaydedildi.')).toBeVisible();
  });
  test('the owner can open the handover of the business for an active member and back out', async ({ page }) => {
    await page.goto(`/panel/${SEED.restaurantSlug}/personel`);
    const members = page.getByRole('region', { name: 'Ekip' });
    const row = members.locator('li[data-member-phone]').filter({ hasText: 'Demo Kurye' });
    await row.getByRole('button', { name: 'Sahipliği devret' }).click();
    const panel = row.getByRole('group', { name: 'İşletme sahipliğini devret' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/tahsilat kartınız işletmeden ayrılır/)).toBeVisible();
    await expect(panel.getByLabel('Devirden sonraki rolünüz')).toBeVisible();
    // Backing out changes nothing; the handover itself is covered by the API scenario.
    await panel.getByRole('button', { name: 'Vazgeç' }).click();
    await expect(panel).toHaveCount(0);
    await expect(row.getByText('Sahip', { exact: true })).toHaveCount(0);
  });
});
