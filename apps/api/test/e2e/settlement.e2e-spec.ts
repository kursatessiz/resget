import { computeModeSettlement, settlementDefaultsFor } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

describe('Settlement preview (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let ownerToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    restaurantId = (await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } })).id;
    // The full engine (PSP fee, withholding) applies when the platform collects.
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'PLATFORM_PSP' } });
    ownerToken = await ctx.login(SEED.ownerPhone);
  });
  afterAll(async () => {
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    await ctx.close();
  });

  it('applies the restaurant contract and the regional defaults in PLATFORM_PSP mode', async () => {
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
    const expected = computeModeSettlement('PLATFORM_PSP', {
      currency: restaurant.currency,
      items: body.items,
      commissionBps: restaurant.commissionBps,
      psp: { percentBps: restaurant.pspPercentBps, fixedMinor: restaurant.pspFixedMinor, bearer: 'RESTAURANT' },
      courier: { costMinor: 4000, bearer: 'RESTAURANT' },
      ...settlementDefaultsFor(restaurant.countryCode),
    });
    expect(res.body.currency).toBe('TRY');
    expect(res.body.paymentMode).toBe('PLATFORM_PSP');
    expect(res.body.payoutMinor).toBe(expected.restaurantPayableMinor);
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
