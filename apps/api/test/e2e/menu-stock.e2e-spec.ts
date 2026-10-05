import type { MenuItemAdminDTO, StorefrontCategoryDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const NOTE = 'e2e-menu-stock';

/** Portions counted per item: sold out at zero, given back on cancellation (docs/STOK.md). */
describe('Menu stock (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let categoryId: string;
  let itemId: string;
  const owner = () => bearer(ownerToken);
  const order = (quantity: number, expected: number) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity }],
        note: NOTE,
      })
      .expect(expected);
  const race = async () =>
    (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/orders`)
        .set(owner())
        .send({
          branchId,
          channel: 'PHONE',
          fulfillment: 'PICKUP',
          items: [{ menuItemId: itemId, quantity: 1 }],
          note: NOTE,
        })
    ).status;
  const stock = async () =>
    (await ctx.prisma.menuItem.findUniqueOrThrow({ where: { id: itemId }, select: { stockQuantity: true } }))
      .stockQuantity;
  const guestItem = async () => {
    const menu = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200);
    const categories = menu.body.categories as StorefrontCategoryDTO[];
    return categories.flatMap((c) => c.items).find((i) => i.id === itemId)!;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.menuCategory.deleteMany({ where: { restaurantId, name: 'E2E Stoklu' } });
    categoryId = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/menu/categories`)
        .set(owner())
        .send({ name: 'E2E Stoklu' })
        .expect(201)
    ).body.id as string;
    const item = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/menu/items`)
        .set(owner())
        .send({ categoryId, name: 'E2E Gunun yemegi', priceMinor: 15000, vatRateBps: 1000, stockQuantity: 3 })
        .expect(201)
    ).body as MenuItemAdminDTO;
    expect(item.stockQuantity).toBe(3);
    itemId = item.id;
  });

  afterAll(async () => {
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.menuCategory.deleteMany({ where: { id: categoryId } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'menu_stock' } });
    await ctx.close();
  });

  it('does not count while the module is off', async () => {
    await order(5, 201);
    expect(await stock()).toBe(3);
    expect((await guestItem()).stockLeft).toBeNull();
  });

  it('takes portions, sells out at zero and never oversells under parallel orders', async () => {
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/menu_stock`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    expect((await guestItem()).stockLeft).toBe(3);
    await order(2, 201);
    expect(await stock()).toBe(1);
    expect((await order(2, 409)).headers['x-error-code']).toBe('MENU_ITEM_SOLD_OUT');
    // Three guests race for the last portion: exactly one gets it.
    const results = await Promise.all([1, 2, 3].map(() => race()));
    expect(results.filter((s) => s === 201)).toHaveLength(1);
    expect(results.filter((s) => s === 409)).toHaveLength(2);
    expect(await stock()).toBe(0);
    const sold = await guestItem();
    expect(sold.isAvailable).toBe(false);
    expect(sold.stockLeft).toBe(0);
  });

  it('gives portions back once when an order is cancelled, and none for a served one', async () => {
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/menu/items/${itemId}`)
      .set(owner())
      .send({ stockQuantity: 4 })
      .expect(200);
    const cancelled = (await order(3, 201)).body.id as string;
    const served = (await order(1, 201)).body.id as string;
    expect(await stock()).toBe(0);
    const transition = (orderId: string, body: Record<string, unknown>) =>
      ctx.http().post(`/restaurants/${restaurantId}/orders/${orderId}/transition`).set(owner()).send(body).expect(200);
    await transition(cancelled, { to: 'REJECTED', reason: 'mutfak kapandi' });
    expect(await stock()).toBe(3);
    await transition(served, { to: 'ACCEPTED', prepMinutes: 5 });
    await transition(served, { to: 'READY' });
    await transition(served, { to: 'PICKED_UP' });
    expect(await stock()).toBe(3);
  });

  it('stops counting when the stock is cleared', async () => {
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/menu/items/${itemId}`)
      .set(owner())
      .send({ stockQuantity: null })
      .expect(200);
    await order(10, 201);
    expect(await stock()).toBeNull();
    expect((await guestItem()).stockLeft).toBeNull();
  });
});
