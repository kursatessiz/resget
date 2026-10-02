import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const stop = {
  address: 'Caferaga Mah. Moda Cad. No 1',
  point: { lat: 40.9867, lng: 29.0263 },
  contactName: 'Demo',
  contactPhone: '+905320000003',
};

describe('Courier quote (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let ownerToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    restaurantId = (await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } })).id;
    ownerToken = await ctx.login(SEED.ownerPhone);
  });
  afterAll(() => ctx.close());

  it('quotes through the mock network and applies the pass-through fee policy', async () => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/quote`)
      .set(bearer(ownerToken))
      .send({
        pickup: stop,
        dropoff: { ...stop, point: { lat: 40.99, lng: 29.03 } },
        parcelValueMinor: 70000,
        currency: 'TRY',
        basketMinor: 70000,
      })
      .expect(200);
    expect(res.body.quote.providerCode).toBe('MOCK');
    expect(res.body.quote.feeMinor).toBeGreaterThan(0);
    // Seeded policy: PASS_THROUGH rounded up to 5 TL steps.
    expect(res.body.customerFeeMinor % 500).toBe(0);
    expect(res.body.customerFeeMinor).toBeGreaterThanOrEqual(res.body.quote.feeMinor);
  });

  it('refuses a quote once the restaurant switches to its own courier', async () => {
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { deliveryMode: 'RESTAURANT_COURIER' } });
    try {
      const res = await ctx
        .http()
        .post(`/restaurants/${restaurantId}/courier/quote`)
        .set(bearer(ownerToken))
        .send({ pickup: stop, dropoff: stop, parcelValueMinor: 1000, currency: 'TRY', basketMinor: 1000 })
        .expect(403);
      expect(res.body.code).toBe('COURIER_QUOTE_FAILED');
    } finally {
      await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { deliveryMode: 'THIRD_PARTY_API' } });
    }
  });
});
