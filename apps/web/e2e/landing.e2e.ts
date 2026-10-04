import { test, expect } from '@playwright/test';

test.describe('Landing page', () => {
  test('renders the headline, the four pillars and the calls to action in Turkish', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('yüzde 1');
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(4);
    await expect(page.getByRole('link', { name: 'İşletmeni kaydet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Giriş yap' })).toBeVisible();
  });

  test('serves the universal link files from the configured store identifiers', async ({ request }) => {
    const apple = await request.get('/.well-known/apple-app-site-association');
    expect(apple.status()).toBe(200);
    const aasa = (await apple.json()) as {
      applinks: { details: { appIDs: string[]; components: { '/': string }[] }[] };
    };
    expect(aasa.applinks.details[0].appIDs).toEqual(['ABCDE12345.com.resget.app']);
    expect(aasa.applinks.details[0].components[0]['/']).toBe('/t/*');

    const android = await request.get('/.well-known/assetlinks.json');
    expect(android.status()).toBe(200);
    const links = (await android.json()) as { target: { package_name: string; sha256_cert_fingerprints: string[] } }[];
    expect(links[0].target.package_name).toBe('com.resget.app');
    expect(links[0].target.sha256_cert_fingerprints).toHaveLength(1);
  });

  test('sends the baseline security headers', async ({ request }) => {
    const res = await request.get('/');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});
