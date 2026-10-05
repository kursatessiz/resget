import { SEED, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const NOTE = 'e2e-dine-in-commission';

/** Dine-in at the table carries no platform commission; delivery and pickup do (docs/MUTABAKAT.md, rule 1). */
describe('Commission by fulfillment (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let restaurantBps: number;
  let itemId: string;
  let tableToken: string;
  const client = `10.81.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;

  const order = async (fulfillment: 'DINE_IN' | 'PICKUP') => {
    const res = await ctx
      .http()
      .post(`/public/qr/${tableToken}/orders`)
      .set('x-forwarded-for', client)
      .send({
        fulfillment,
        items: [{ menuItemId: itemId, quantity: 2 }],
        customer: { fullName: 'Masa Musteri', phone: '05329990997' },
        payment: { method: 'CASH_ON_DELIVERY' },
        note: NOTE,
      })
      .expect(201);
    return ctx.prisma.order.findFirstOrThrow({ where: { trackingToken: res.body.trackingToken } });
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { menuItems: true, tables: true },
    });
    restaurantId = restaurant.id;
    restaurantBps = restaurant.commissionBps;
    itemId = restaurant.menuItems.find((m) => m.name === 'Izgara kofte')!.id;
    tableToken = restaurant.tables.find((t) => t.isActive)!.qrToken;
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
  });

  afterAll(async () => {
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.close();
  });

  it('places a dine-in order without commission', async () => {
    const dineIn = await order('DINE_IN');
    expect(dineIn.commissionBps).toBe(0);
    expect(dineIn.platformCommissionMinor).toBe(0);
    expect(dineIn.commissionVatMinor).toBe(0);
    expect(dineIn.platformReceivableMinor).toBe(0);
  });

  it('keeps the restaurant rate for pickup from the same table', async () => {
    expect(restaurantBps).toBeGreaterThan(0);
    const pickup = await order('PICKUP');
    expect(pickup.commissionBps).toBe(restaurantBps);
    expect(pickup.platformCommissionMinor).toBeGreaterThan(0);
  });
});
