import { test, expect } from '@playwright/test';
import { SEED } from './support/seed';
import { OWNER_STATE } from './support/session';

interface GuestMenu {
  categories: { name: string; items: { name: string; isAvailable: boolean }[] }[];
}

test.describe('Menu editor, tables and settings', () => {
  test.use({ storageState: OWNER_STATE });

  test('the owner adds a menu item, prints table labels and saves settings', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const categoryName = `PW Tatlilar ${stamp}`;
    const itemName = `PW Baklava ${stamp}`;

    // Menu editor: a new category and item, then the item goes sold out.
    await page.goto(`/panel/${SEED.restaurantSlug}/menu`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Menü yönetimi');
    await page.getByLabel('Kategori adı').fill(categoryName);
    await page.getByRole('button', { name: 'Kategori ekle' }).click();
    const category = page.getByRole('region', { name: categoryName });
    await expect(category).toBeVisible();
    await category.getByRole('button', { name: 'Ürün ekle' }).click();
    await category.getByLabel('Ürün adı').fill(itemName);
    await category.getByLabel(/^Fiyat \(/).fill('120,50');
    await category.getByLabel('KDV (%)').fill('10');
    await category.getByRole('button', { name: 'Kaydet' }).click();
    await expect(category.getByText(itemName)).toBeVisible();
    await expect(category.getByText(/120,50/)).toBeVisible();
    await category.getByRole('button', { name: 'Tükendi işaretle' }).click();
    await expect(category.getByText('Tükendi', { exact: true })).toBeVisible();

    const guestMenu = await page.request.get(`/api/bff/public/qr/${SEED.tableToken}`);
    expect(guestMenu.ok()).toBeTruthy();
    const body = (await guestMenu.json()) as GuestMenu;
    const guestItem = body.categories.find((c) => c.name === categoryName)?.items.find((i) => i.name === itemName);
    expect(guestItem?.isAvailable).toBe(false);

    // Tables: a new table with a downloadable label, and the print sheet.
    const tableLabel = `PW${stamp.slice(-4)}`;
    await page.goto(`/panel/${SEED.restaurantSlug}/masalar`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Masalar ve QR');
    await page.getByLabel('Masa adı').fill(tableLabel);
    await page.getByRole('button', { name: 'Masa ekle' }).click();
    const row = page.locator(`[data-table-label="${tableLabel}"]`);
    await expect(row).toBeVisible();
    const svgHref = await row.getByRole('link', { name: 'Etiketi indir (SVG)' }).getAttribute('href');
    const svg = await page.request.get(svgHref ?? '');
    expect(svg.ok()).toBeTruthy();
    expect(svg.headers()['content-type']).toContain('image/svg+xml');
    expect(await svg.text()).toContain(tableLabel);
    const pngHref = await row.getByRole('link', { name: 'QR indir (PNG)' }).getAttribute('href');
    const png = await page.request.get(pngHref ?? '');
    expect(png.headers()['content-type']).toContain('image/png');

    await page.goto(`/panel/${SEED.restaurantSlug}/masalar/yazdir`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('QR etiketleri');
    await expect(page.getByRole('img', { name: `Masa ${tableLabel}` })).toBeVisible();

    // Settings: two sections save and confirm.
    await page.goto(`/panel/${SEED.restaurantSlug}/ayarlar`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ayarlar');
    const business = page.getByRole('region', { name: 'İşletme' });
    await business.getByLabel('Ticari unvan').fill(`PW Gida ${stamp}`);
    await business.getByRole('button', { name: 'Kaydet' }).click();
    await expect(business.getByText('Kaydedildi.')).toBeVisible();
    const dispatch = page.getByRole('region', { name: 'Sevk ayarları' });
    await dispatch.getByLabel('Varsayılan hazırlık süresi (dk)').fill('25');
    await dispatch.getByRole('button', { name: 'Kaydet' }).click();
    await expect(dispatch.getByText('Kaydedildi.')).toBeVisible();

    // Payments: mode, POS connection and meal cards render from the API.
    await page.goto(`/panel/${SEED.restaurantSlug}/odeme`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ödeme ayarları');
    await expect(page.getByRole('region', { name: 'Ödeme modu' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Yemek kartları' })).toContainText('Multinet');
  });
});
