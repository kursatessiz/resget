import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Coupons and promo codes (docs/KUPONLAR.md): panel, public lookup, checkout, limits and release on cancel. */
describe('Coupons (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let itemId: string;
  const created: string[] = [];
  // Kofte is 420.00 in the seed; two make a basket of 840.00.
  const PHONE_A = '05329990941';
  const PHONE_B = '05329990942';
  // A phone that never ordered here, fresh on every run (customer rows outlive the orders this spec deletes).
  const FRESH_PHONE = `0533${String(Date.now()).slice(-7)}`;

  const owner = () => bearer(ownerToken, restaurantId);
  const setSwitch = (enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/coupons`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const createCoupon = (body: Record<string, unknown>, expected = 201) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/coupons`)
      .set(owner())
      .send({
        minBasketMinor: 0,
        firstOrderOnly: false,
        perCustomerLimit: 1,
        maxRedemptions: null,
        startsAt: null,
        endsAt: null,
        ...body,
      })
      .expect(expected);
  const pickup = (phone: string, couponCode: string | undefined, expected: number, quantity = 2) =>
    ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity }],
        customer: { fullName: 'Kupon Musteri', phone },
        payment: { method: 'CASH_ON_DELIVERY' },
        ...(couponCode ? { couponCode } : {}),
      })
      .expect(expected)
      .then(async (res) => {
        if (res.status === 201) {
          const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: res.body.trackingToken } });
          created.push(order.id);
          return Object.assign(res, { orderId: order.id });
        }
        return Object.assign(res, { orderId: '' });
      });

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    restaurantId = (
      await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug }, select: { id: true } })
    ).id;
    itemId = (await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, name: 'Izgara kofte' } })).id;
  });

  afterAll(async () => {
    await ctx.prisma.featureFlag.deleteMany({ where: { key: 'coupons' } });
    if (created.length) await ctx.prisma.order.deleteMany({ where: { id: { in: created } } });
    await ctx.prisma.coupon.deleteMany({ where: { restaurantId, code: { startsWith: 'E2E' } } });
    await ctx.prisma.auditLog.deleteMany({ where: { action: { startsWith: 'coupon.' } } });
    await ctx.close();
  });

  it('ships switched off: the screen is closed and a code reads as unknown', async () => {
    const refused = await ctx.http().get(`/restaurants/${restaurantId}/coupons`).set(owner()).expect(403);
    expect(refused.body.code).toBe('FEATURE_DISABLED');
    await ctx.prisma.coupon.create({
      data: { restaurantId, code: 'E2E-HIDDEN', kind: 'AMOUNT', amountMinor: 1000 },
    });
    const unknown = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/coupons/e2e-hidden`).expect(404);
    expect(unknown.body.code).toBe('COUPON_NOT_FOUND');
    const order = await pickup(PHONE_A, 'E2E-HIDDEN', 404);
    expect(order.body.code).toBe('COUPON_NOT_FOUND');
  });

  it('creates coupons, refuses a duplicate code and shows a typed code on the menu page', async () => {
    await setSwitch(true);
    const percent = await createCoupon({
      code: 'e2e-yuzde15',
      kind: 'PERCENT',
      percentBps: 1500,
      maxDiscountMinor: 10000,
      minBasketMinor: 50000,
      maxRedemptions: 1,
    });
    expect(percent.body).toMatchObject({ code: 'E2E-YUZDE15', redemptionCount: 0, isActive: true });
    const taken = await createCoupon({ code: 'E2E-YUZDE15', kind: 'AMOUNT', amountMinor: 500 }, 409);
    expect(taken.body.code).toBe('COUPON_CODE_TAKEN');
    const shown = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/coupons/e2e-yuzde15`).expect(200);
    expect(shown.body).toMatchObject({ code: 'E2E-YUZDE15', kind: 'PERCENT', percentBps: 1500, minBasketMinor: 50000 });
  });

  it('applies the discount as restaurant-funded, enforces the basket and the total limit, and gives the use back on cancel', async () => {
    const small = await pickup(PHONE_A, 'E2E-YUZDE15', 409, 1);
    expect(small.body.code).toBe('COUPON_MIN_BASKET');

    // 15 percent of 840.00 is 126.00, capped at 100.00.
    const first = await pickup(PHONE_A, 'E2E-YUZDE15', 201);
    expect(first.body.discountMinor).toBe(10000);
    expect(first.body.chargedToCustomerMinor).toBe(84000 - 10000);
    const row = await ctx.prisma.order.findUniqueOrThrow({ where: { id: first.orderId } });
    expect(row.discountFundedBy).toBe('RESTAURANT');
    // Commission is computed on what the customer pays for the items.
    expect(row.platformCommissionMinor).toBe(Math.round((74000 * row.commissionBps) / 10000));

    const limit = await pickup(PHONE_B, 'E2E-YUZDE15', 409);
    expect(limit.body.code).toBe('COUPON_LIMIT_REACHED');

    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${first.orderId}/transition`)
      .set(owner())
      .send({ to: 'REJECTED', reason: 'Kapanis' })
      .expect(200);
    const again = await pickup(PHONE_B, 'E2E-YUZDE15', 201);
    expect(again.body.discountMinor).toBe(10000);
    const list = await ctx.http().get(`/restaurants/${restaurantId}/coupons`).set(owner()).expect(200);
    expect(
      (list.body as { code: string; redemptionCount: number; discountTotalMinor: number }[]).find(
        (c) => c.code === 'E2E-YUZDE15',
      ),
    ).toMatchObject({
      redemptionCount: 1,
      discountTotalMinor: 10000,
    });
  });

  it('keeps first-order and per-customer rules and needs a phone', async () => {
    await createCoupon({ code: 'E2E-ILK', kind: 'AMOUNT', amountMinor: 2500, firstOrderOnly: true });
    const returning = await pickup(PHONE_B, 'E2E-ILK', 409);
    expect(returning.body.code).toBe('COUPON_FIRST_ORDER_ONLY');
    const fresh = await pickup(FRESH_PHONE, 'E2E-ILK', 201);
    expect(fresh.body.discountMinor).toBe(2500);

    await createCoupon({ code: 'E2E-TEKRAR', kind: 'AMOUNT', amountMinor: 1000, perCustomerLimit: 1 });
    await pickup(PHONE_A, 'E2E-TEKRAR', 201);
    const twice = await pickup(PHONE_A, 'E2E-TEKRAR', 409);
    expect(twice.body.code).toBe('COUPON_ALREADY_USED');

    const table = await ctx.prisma.diningTable.findFirstOrThrow({ where: { restaurantId, isActive: true } });
    const dineIn = await ctx
      .http()
      .post(`/public/qr/${table.qrToken}/orders`)
      .send({
        fulfillment: 'DINE_IN',
        items: [{ menuItemId: itemId, quantity: 2 }],
        payment: { method: 'CASH_ON_DELIVERY' },
        couponCode: 'E2E-TEKRAR',
      })
      .expect(409);
    expect(dineIn.body.code).toBe('COUPON_PHONE_REQUIRED');
  });

  it('pauses, refuses to delete a used coupon and deletes an unused one', async () => {
    const list = await ctx.http().get(`/restaurants/${restaurantId}/coupons`).set(owner()).expect(200);
    const used = (list.body as { id: string; code: string }[]).find((c) => c.code === 'E2E-ILK')!;
    const paused = await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/coupons/${used.id}`)
      .set(owner())
      .send({ isActive: false })
      .expect(200);
    expect(paused.body.isActive).toBe(false);
    await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/coupons/E2E-ILK`).expect(404);
    const inUse = await ctx.http().delete(`/restaurants/${restaurantId}/coupons/${used.id}`).set(owner()).expect(409);
    expect(inUse.body.code).toBe('COUPON_IN_USE');
    const unused = await createCoupon({ code: 'E2E-SIL', kind: 'AMOUNT', amountMinor: 100 });
    await ctx.http().delete(`/restaurants/${restaurantId}/coupons/${unused.body.id}`).set(owner()).expect(204);
    await setSwitch(null);
  });
});
