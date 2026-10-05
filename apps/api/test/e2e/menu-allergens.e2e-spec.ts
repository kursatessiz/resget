import type { MenuItemAdminDTO, StorefrontDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Allergens and dietary tags (docs/ALERJENLER.md): stored on items, shown to guests only while the module is on. */
describe('Menu allergens (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let categoryId: string;
  let itemId: string;
  const owner = () => bearer(ownerToken, restaurantId);
  const base = () => `/restaurants/${restaurantId}/menu`;
  const storefrontItem = async () => {
    const page = (await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200))
      .body as StorefrontDTO;
    return page.categories.flatMap((c) => c.items).find((i) => i.id === itemId);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    restaurantId = (
      await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug }, select: { id: true } })
    ).id;
    categoryId = (await ctx.prisma.menuCategory.findFirstOrThrow({ where: { restaurantId, isActive: true } })).id;
  });

  afterAll(async () => {
    if (itemId) await ctx.prisma.menuItem.deleteMany({ where: { id: itemId } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'allergens' } });
    await ctx.close();
  });

  it('stores declared allergens and tags in catalogue order and refuses unknown or repeated ones', async () => {
    const item = { categoryId, name: 'Alerjen testi', priceMinor: 12000, vatRateBps: 1000 };
    await ctx
      .http()
      .post(`${base()}/items`)
      .set(owner())
      .send({ ...item, allergens: ['shellfish'] })
      .expect(400);
    await ctx
      .http()
      .post(`${base()}/items`)
      .set(owner())
      .send({ ...item, allergens: ['milk', 'milk'] })
      .expect(400);
    const created = (
      await ctx
        .http()
        .post(`${base()}/items`)
        .set(owner())
        .send({ ...item, allergens: ['milk', 'gluten'], dietaryTags: ['vegetarian'] })
        .expect(201)
    ).body as MenuItemAdminDTO;
    itemId = created.id;
    expect(created.allergens).toEqual(['gluten', 'milk']);
    expect(created.dietaryTags).toEqual(['vegetarian']);

    const updated = (
      await ctx
        .http()
        .patch(`${base()}/items/${itemId}`)
        .set(owner())
        .send({ allergens: ['sesame'], dietaryTags: ['vegan', 'spicy'] })
        .expect(200)
    ).body as MenuItemAdminDTO;
    expect(updated.allergens).toEqual(['sesame']);
    expect(updated.dietaryTags).toEqual(['vegan', 'spicy']);
  });

  it('shows them to guests only while the module is on', async () => {
    expect(await storefrontItem()).toMatchObject({ allergens: [], dietaryTags: [] });
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/allergens`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    expect(await storefrontItem()).toMatchObject({ allergens: ['sesame'], dietaryTags: ['vegan', 'spicy'] });
    const table = await ctx.http().get(`/public/qr/${SEED.tableToken}`).expect(200);
    const fromTable = (table.body as StorefrontDTO).categories.flatMap((c) => c.items).find((i) => i.id === itemId);
    expect(fromTable?.allergens).toEqual(['sesame']);
  });
});
