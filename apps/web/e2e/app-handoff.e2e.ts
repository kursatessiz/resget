import { test, expect } from '@playwright/test';
import type { SessionHandoffDTO, TokenPairDTO } from '@resget/shared';

const API_URL = 'http://localhost:4000';
const OTP = process.env.OTP_TEST_CODE ?? '482915';
/** Not seeded: the app's customer that hands its session to the browser. */
const PHONE = '05320000043';

/** The mobile app's side (docs/GUVENLIK.md): sign in with the API, then ask for a one-time handoff code. */
async function appHandoff(request: import('@playwright/test').APIRequestContext): Promise<string> {
  await request.post(`${API_URL}/auth/otp/request`, { data: { phone: PHONE } });
  const verified = await request.post(`${API_URL}/auth/otp/verify`, {
    data: { phone: PHONE, code: OTP, fullName: 'PW Uygulama' },
  });
  expect(verified.ok()).toBe(true);
  const tokens = (await verified.json()) as TokenPairDTO;
  const handoff = await request.post(`${API_URL}/auth/handoff`, {
    headers: { authorization: `Bearer ${tokens.accessToken}` },
  });
  expect(handoff.status()).toBe(200);
  return ((await handoff.json()) as SessionHandoffDTO).code;
}

test.describe('App to web handoff', () => {
  test('a handoff code signs the browser in once and lands on a local path', async ({ browser, request }) => {
    const code = await appHandoff(request);

    const first = await browser.newContext({ locale: 'tr-TR' });
    const page = await first.newPage();
    await page.goto(`/api/session/handoff?code=${code}&next=${encodeURIComponent('/hesabim')}`);
    await expect(page).toHaveURL(/\/hesabim$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hesabım');
    await first.close();

    // Spent: the same code leaves a fresh browser signed out, and a foreign target stays on this site.
    const second = await browser.newContext({ locale: 'tr-TR' });
    const again = await second.newPage();
    await again.goto(`/api/session/handoff?code=${code}&next=${encodeURIComponent('/hesabim')}`);
    await expect(again).toHaveURL(/\/giris/);
    await again.goto(`/api/session/handoff?code=${code}&next=${encodeURIComponent('//evil.example/x')}`);
    await expect(again).toHaveURL(/^http:\/\/localhost:\d+\/$/);
    await second.close();
  });

  test('a wallet return the browser kept offers to reopen the app with the same parameters', async ({ page }) => {
    await page.goto('/uygulama/cuzdan/MASTERPASS?mockLink=abc');
    const card = page.locator('[data-app-wallet-return]');
    await expect(card).toContainText('Cüzdan bağlama uygulamada tamamlanır.');
    await expect(card.getByRole('link', { name: 'Uygulamayı aç' })).toHaveAttribute(
      'href',
      'resget://uygulama/cuzdan/MASTERPASS?mockLink=abc',
    );
    expect((await page.goto('/uygulama/cuzdan/MOCK'))?.status()).toBe(404);
  });
});
