import { normalizePhone } from '@resget/shared';
import type { MenuItemAdminDTO, OrderDetailDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const CUSTOMER_PHONE = normalizePhone('05329990991')!;
const NOTE = 'e2e-order-modifiers';

/** The menu prices an order line's options, never the client. */
describe('Order line options (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let categoryId: string;
  let item: MenuItemAdminDTO;
  // Our own client address, so the public order limit is not shared with other suites.
  const client = `10.79.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;

  const publicOrder = (modifiers: Record<string, unknown>[]) =>
    ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .set('x-forwarded-for', client)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId: item.id, quantity: 2, modifiers }],
        customer: { fullName: 'Secenek Musteri', phone: CUSTOMER_PHONE },
        payment: { method: 'CASH_ON_DELIVERY' },
        note: NOTE,
      });
  const option = (group: string, name: string) => {
    const g = item.modifierGroups.find((x) => x.name === group)!;
    return g.modifiers.find((m) => m.name === name)!;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    ownerToken = await ctx.login(SEED.ownerPhone);
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.menuCategory.deleteMany({ where: { restaurantId, name: 'E2E Secenekli' } });
    categoryId = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/menu/categories`)
        .set(bearer(ownerToken))
        .send({ name: 'E2E Secenekli' })
        .expect(201)
    ).body.id as string;
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/menu/items`)
      .set(bearer(ownerToken))
      .send({ categoryId, name: 'E2E Pide', priceMinor: 10000, vatRateBps: 1000 })
      .expect(201);
    item = (
      await ctx
        .http()
        .put(`/restaurants/${restaurantId}/menu/items/${created.body.id}/modifier-groups`)
        .set(bearer(ownerToken))
        .send({
          groups: [
            {
              name: 'Boyut',
              minSelect: 1,
              maxSelect: 1,
              modifiers: [
                { name: 'Kucuk', priceDeltaMinor: 0 },
                { name: 'Buyuk', priceDeltaMinor: 2000 },
              ],
            },
            {
              name: 'Ekstra',
              minSelect: 0,
              maxSelect: 2,
              modifiers: [{ name: 'Kasar', priceDeltaMinor: 500 }],
            },
          ],
        })
        .expect(200)
    ).body as MenuItemAdminDTO;
  });

  afterAll(async () => {
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.menuCategory.deleteMany({ where: { restaurantId, id: categoryId } });
    await ctx.close();
  });

  it('rejects a price the client made up and an option the menu does not have', async () => {
    const cheap = await publicOrder([{ name: 'Boyut: Buyuk', priceDeltaMinor: -10000 }]).expect(409);
    expect(cheap.headers['x-error-code']).toBe('MODIFIER_PRICE_CHANGED');
    const invented = await publicOrder([
      { name: 'Boyut: Kucuk', priceDeltaMinor: 0 },
      { name: 'Indirim', priceDeltaMinor: -5000 },
    ]).expect(409);
    expect(invented.headers['x-error-code']).toBe('MODIFIER_INVALID');
    // A required group left empty.
    expect((await publicOrder([]).expect(409)).headers['x-error-code']).toBe('MODIFIER_INVALID');
  });

  it('charges the menu price for options chosen by id or by name', async () => {
    const large = option('Boyut', 'Buyuk');
    const res = await publicOrder([
      { id: large.id, name: 'Boyut: Buyuk', priceDeltaMinor: 2000 },
      { name: 'Ekstra: Kasar', priceDeltaMinor: 500 },
    ]).expect(201);
    expect(res.body.chargedToCustomerMinor).toBe((10000 + 2000 + 500) * 2);
    const order = await ctx.prisma.order.findFirstOrThrow({
      where: { trackingToken: res.body.trackingToken },
      include: { items: true },
    });
    expect(order.items[0].modifiersSnapshot).toEqual([
      { name: 'Boyut: Buyuk', priceDeltaMinor: 2000 },
      { name: 'Ekstra: Kasar', priceDeltaMinor: 500 },
    ]);
  });

  it('applies the same rule to staff orders', async () => {
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken))
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: item.id, quantity: 1, modifiers: [{ name: 'Boyut: Kucuk', priceDeltaMinor: -10000 }] }],
        note: NOTE,
      })
      .expect(409);
    const ok = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/orders`)
        .set(bearer(ownerToken))
        .send({
          branchId,
          channel: 'PHONE',
          fulfillment: 'PICKUP',
          items: [{ menuItemId: item.id, quantity: 1, modifiers: [{ name: 'Kucuk', priceDeltaMinor: 0 }] }],
          note: NOTE,
        })
        .expect(201)
    ).body as OrderDetailDTO;
    expect(ok.chargedToCustomerMinor).toBe(10000);
  });
});
