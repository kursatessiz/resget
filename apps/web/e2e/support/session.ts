import type { APIRequestContext, Page } from '@playwright/test';

const OTP = process.env.OTP_TEST_CODE ?? '482915';

/** Signs in through the real screens; the session then lives in httpOnly cookies the page's request context shares. */
export async function signIn(page: Page, phone: string): Promise<void> {
  await page.goto('/giris');
  await page.getByLabel('Telefon numarası').fill(phone);
  await page.getByRole('button', { name: 'Kod gönder' }).click();
  await page.getByLabel('Doğrulama kodu').fill(OTP);
  await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
  await page.waitForURL(/\/panel/, { timeout: 15_000 });
}

/** Calls the API through the BFF with the signed-in page's cookies. */
export async function bff<T>(
  request: APIRequestContext,
  path: string,
  init: { method?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`/api/bff/${path.replace(/^\//, '')}`, {
    method: init.method ?? 'GET',
    data: init.data,
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok()) throw new Error(`${path} failed with ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}
