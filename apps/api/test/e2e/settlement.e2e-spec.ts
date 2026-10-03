import { computeOrderSettlement, settlementDefaultsFor } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

describe('Settlement preview (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let ownerToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    restaurantId = (await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } })).id;
    ownerToken = await ctx.login(SEED.ownerPhone);
  });
  afterAll(() => ctx.close());

  it('applies the restaurant contract and the regional defaults', async () => {
    const body = {
      items: [{ amountMinor: 50000, vatRateBps: 1000 }],
      courier: { costMinor: 4000, bearer: 'RESTAURANT' },
    };
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/settlement-preview`)
      .set(bearer(ownerToken))
      .send(body)
      .expect(200);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    const expected = computeOrderSettlement({
      currency: restaurant.currency,
      items: body.items,
      commissionBps: restaurant.commissionBps,
      psp: { percentBps: restaurant.pspPercentBps, fixedMinor: restaurant.pspFixedMinor, bearer: 'RESTAURANT' },
      courier: { costMinor: 4000, bearer: 'RESTAURANT' },
      ...settlementDefaultsFor(restaurant.countryCode),
    });
    expect(res.body.currency).toBe('TRY');
    expect(res.body.platformCommissionMinor).toBe(500);
    expect(res.body.withholdingMinor).toBe(455);
    expect(res.body.restaurantPayableMinor).toBe(expected.restaurantPayableMinor);
    expect(res.body.ledger.at(-1)).toEqual({
      type: 'RESTAURANT_PAYABLE',
      amountMinor: expected.restaurantPayableMinor,
    });
  });

  it('validates the body', async () => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/settlement-preview`)
      .set(bearer(ownerToken))
      .send({ items: [] })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION');
  });
});
