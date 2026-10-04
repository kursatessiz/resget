import { test, expect } from '@playwright/test';
import type { AdminRestaurantPageDTO } from '@resget/shared';
import { SEED } from './support/seed';
import { ADMIN_STATE, OWNER_STATE, bff } from './support/session';

test.describe('Restaurant referrals', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the console turns the programme on, the owner takes an invite link and the sign-up page shows the invitation', async ({
    page,
    browser,
  }) => {
    const restaurants = await bff<AdminRestaurantPageDTO>(
      page.request,
      `admin/restaurants?query=${SEED.restaurantSlug}`,
    );
    const restaurantId = restaurants.items.find((r) => r.slug === SEED.restaurantSlug)?.id;
    expect(restaurantId).toBeTruthy();
    try {
      await bff(page.request, `admin/restaurants/${restaurantId}/features/partner_referrals`, {
        method: 'PUT',
        data: { enabled: true },
      });
      await page.goto('/admin');
      await page.getByRole('complementary').getByRole('link', { name: 'Restoran tavsiyesi' }).click();
      await expect(page).toHaveURL(/\/admin\/tavsiye$/);
      await expect(page.getByRole('heading', { name: 'Restoran tavsiyesi', level: 1 })).toBeVisible();
      await page.getByLabel('Program açık').check();
      await page.getByLabel('Yeni restorana kayıtta verilen ek PRO günü').fill('20');
      await page.getByLabel('Ödül için yeni restoranın tamamlaması gereken sipariş').fill('5');
      await page.getByRole('button', { name: 'Kaydet' }).click();
      await expect(page.getByRole('status')).toHaveText('Ayarlar kaydedildi.');

      const ownerContext = await browser.newContext({ storageState: OWNER_STATE, locale: 'tr-TR' });
      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto(`/panel/${SEED.restaurantSlug}/plan`);
      const card = ownerPage.getByRole('region', { name: 'Restoran davet et' });
      await expect(card).toContainText('20 gün ek PRO');
      await expect(card).toContainText('5 siparişi tamamlayınca');
      const create = card.getByRole('button', { name: 'Davet bağlantımı oluştur' });
      if (await create.isVisible()) await create.click();
      const link = await card.getByRole('textbox', { name: 'Davet bağlantısı' }).inputValue();
      expect(link).toMatch(/\/kayit\?davet=P[2-9A-Z]{7}$/);

      // The owner is signed in, so the sign-up page opens directly with the invitation.
      await ownerPage.goto(link);
      await expect(ownerPage.locator('[data-partner-invite]')).toHaveText(
        `${SEED.restaurantName} sizi davet etti: kayıt olunca 20 gün ek PRO kullanırsınız.`,
      );
      await ownerContext.close();
    } finally {
      await bff(page.request, 'admin/partner-referrals/config', {
        method: 'PUT',
        data: {
          isActive: false,
          referrerRewardDays: 30,
          refereeBonusDays: 30,
          qualifyingOrders: 10,
          yearlyCapPerReferrer: 12,
        },
      });
      await bff(page.request, `admin/restaurants/${restaurantId}/features/partner_referrals`, {
        method: 'PUT',
        data: { enabled: null },
      });
    }
  });
});
