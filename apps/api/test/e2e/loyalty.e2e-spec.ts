import { normalizePhone, redeemableFor } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyEarnedNotifier } from '../../src/modules/orders/loyalty-earned.notifier';

/** Loyalty program (docs/SADAKAT.md): earn on completion with a welcome bonus, spend at checkout, reversal, staff adjustment, plan gate. */
describe('Loyalty (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let restaurantId: string;
  let menuItemId: string;
  let itemPriceMinor: number;
  let subscriptionId: string | null = null;
  let trialEndsAt: Date | null = null;
  const phone = normalizePhone('05329990931')!;
  const otherPhone = normalizePhone('05329990932')!;
  const orderIds: string[] = [];
  const program = {
    enabled: true,
    earnPoints: 1,
    earnStepMinor: 100,
    redeemPoints: 10,
    redeemValueMinor: 500,
    minOrderMinor: 0,
    maxDiscountBps: 5000,
    welcomePoints: 20,
  };

  const publicOrder = (body: Record<string, unknown>, token?: string) => {
    const req = ctx.http().post(`/public/restaurants/${SEED.restaurantSlug}/orders`);
    return (token ? req.set(bearer(token)) : req).send({
      fulfillment: 'PICKUP',
      items: [{ menuItemId, quantity: 2 }],
      customer: { fullName: 'Sadik Musteri', phone },
      payment: { method: 'CASH_ON_DELIVERY' },
      ...body,
    });
  };
  const transition = (id: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${id}/transition`)
      .set(bearer(ownerToken, restaurantId))
      .send({ to, ...extra })
      .expect(200);
  const orderIdOf = async (trackingToken: string): Promise<string> => {
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken }, select: { id: true } });
    orderIds.push(order.id);
    return order.id;
  };
  const balance = async (): Promise<number> =>
    (
      await ctx.prisma.restaurantCustomer.findFirstOrThrow({
        where: { restaurantId, user: { phone } },
        select: { loyaltyPoints: true },
      })
    ).loyaltyPoints;

  beforeAll(async () => {
    ctx = await createTestApp();
    ownerToken = await ctx.login(SEED.ownerPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, subscription: { select: { id: true, trialEndsAt: true } } },
    });
    restaurantId = restaurant.id;
    subscriptionId = restaurant.subscription?.id ?? null;
    trialEndsAt = restaurant.subscription?.trialEndsAt ?? null;
    const item = await ctx.prisma.menuItem.findFirstOrThrow({
      where: { restaurantId, isAvailable: true },
      select: { id: true, priceMinor: true },
    });
    menuItemId = item.id;
    itemPriceMinor = item.priceMinor;
    await ctx.prisma.user.deleteMany({ where: { phone: { in: [phone, otherPhone] } } });
    await ctx.prisma.loyaltyProgram.deleteMany({ where: { restaurantId } });
  });

  afterAll(async () => {
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.prisma.restaurantCustomer.deleteMany({
      where: { restaurantId, user: { phone: { in: [phone, otherPhone] } } },
    });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: [phone, otherPhone] } } });
    await ctx.prisma.loyaltyProgram.deleteMany({ where: { restaurantId } });
    if (subscriptionId)
      await ctx.prisma.restaurantSubscription.update({ where: { id: subscriptionId }, data: { trialEndsAt } });
    await ctx.close();
  });

  it('starts with defaults, saves the rules, and a completed order earns points plus the welcome bonus once', async () => {
    const before = await ctx.http().get(`/restaurants/${restaurantId}/loyalty`).set(bearer(ownerToken, restaurantId));
    expect(before.status).toBe(200);
    expect(before.body.program.enabled).toBe(false);
    expect(before.body.program.active).toBe(false);
    expect(before.body.program.earnStepMinor).toBe(100);

    const saved = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/loyalty`)
      .set(bearer(ownerToken, restaurantId))
      .send(program)
      .expect(200);
    expect(saved.body.active).toBe(true);
    expect(saved.body.welcomePoints).toBe(20);

    // The storefront now shows the rules.
    const menu = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200);
    expect(menu.body.loyalty).toEqual({
      earnPoints: 1,
      earnStepMinor: 100,
      redeemPoints: 10,
      redeemValueMinor: 500,
      minOrderMinor: 0,
      maxDiscountBps: 5000,
    });

    const placed = await publicOrder({}).expect(201);
    expect(placed.body.loyaltyPointsRedeemed).toBe(0);
    expect(placed.body.discountMinor).toBe(0);
    const orderId = await orderIdOf(placed.body.trackingToken);
    // Nothing is earned until the order completes.
    expect(await balance()).toBe(0);
    await transition(orderId, 'ACCEPTED', { prepMinutes: 5 });
    await transition(orderId, 'READY');
    await transition(orderId, 'PICKED_UP');

    const earned = Math.floor((2 * itemPriceMinor) / 100);
    expect(await balance()).toBe(20 + earned);
    const rows = await ctx.prisma.loyaltyTransaction.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.type, r.points])).toEqual([
      ['WELCOME', 20],
      ['EARN', earned],
    ]);
    // Idempotent: running the completion hook again writes nothing.
    const service = ctx.app.get(LoyaltyService);
    const again = await ctx.prisma.$transaction((tx) => service.recordCompletion(tx, orderId));
    expect(again).toBe(0);
    expect(await balance()).toBe(20 + earned);

    const overview = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/loyalty`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(overview.body.stats.members).toBeGreaterThanOrEqual(1);
    expect(overview.body.stats.pointsEarned).toBeGreaterThanOrEqual(20 + earned);
    expect(overview.body.recent[0].type).toBe('EARN');
  });

  it('spends points at checkout only for the signed-in phone, and gives them back when the order is rejected', async () => {
    const customerToken = await ctx.login(phone);
    const before = await balance();
    const itemsGross = 2 * itemPriceMinor;
    const expected = redeemableFor(program, before, itemsGross);
    expect(expected.points).toBeGreaterThan(0);

    // Anonymous: no.
    await publicOrder({ useLoyaltyPoints: true }).expect(409).expect('x-error-code', 'LOYALTY_SIGN_IN_REQUIRED');
    // Signed in but ordering for another number: no.
    await publicOrder(
      { useLoyaltyPoints: true, customer: { fullName: 'Baska Biri', phone: otherPhone } },
      customerToken,
    )
      .expect(409)
      .expect('x-error-code', 'LOYALTY_PHONE_MISMATCH');

    const placed = await publicOrder({ useLoyaltyPoints: true }, customerToken).expect(201);
    expect(placed.body.loyaltyPointsRedeemed).toBe(expected.points);
    expect(placed.body.discountMinor).toBe(expected.discountMinor);
    expect(placed.body.chargedToCustomerMinor).toBe(itemsGross - expected.discountMinor);
    const orderId = await orderIdOf(placed.body.trackingToken);
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.discountFundedBy).toBe('RESTAURANT');
    // The commission base is the discounted items total.
    expect(order.platformCommissionMinor).toBeLessThanOrEqual(
      Math.ceil(((itemsGross - expected.discountMinor) * order.commissionBps) / 10000) + 1,
    );
    expect(await balance()).toBe(before - expected.points);

    // The viewer and the account both show the balance.
    const viewer = await ctx
      .http()
      .get(`/me/viewer?restaurantId=${restaurantId}`)
      .set(bearer(customerToken))
      .expect(200);
    expect(viewer.body.loyaltyPoints).toBe(before - expected.points);
    const account = await ctx.http().get('/me/account').set(bearer(customerToken)).expect(200);
    const mine = account.body.loyalty.find(
      (b: { restaurant: { slug: string } }) => b.restaurant.slug === SEED.restaurantSlug,
    );
    expect(mine).toBeDefined();
    expect(mine.points).toBe(before - expected.points);

    // The restaurant rejects: the points come back, once.
    await transition(orderId, 'REJECTED', { reason: 'out of stock' });
    expect(await balance()).toBe(before);
    const reversal = await ctx.prisma.loyaltyTransaction.findMany({ where: { orderId, type: 'REVERSAL' } });
    expect(reversal).toHaveLength(1);
    expect(reversal[0].points).toBe(expected.points);
  });

  it('tells the customer about points earned once, only when the restaurant turned it on', async () => {
    const owner = bearer(ownerToken, restaurantId);
    const startedAt = new Date();
    const notices = () =>
      ctx.prisma.messageLog.count({
        where: { restaurantId, templateKey: 'loyalty.earned', createdAt: { gte: startedAt } },
      });
    const complete = async () => {
      const placed = await publicOrder({}).expect(201);
      const orderId = await orderIdOf(placed.body.trackingToken);
      await transition(orderId, 'ACCEPTED', { prepMinutes: 5 });
      await transition(orderId, 'READY');
      await transition(orderId, 'PICKED_UP');
      return orderId;
    };
    // The order listener runs after the order is published.
    const settle = async (expected: number) => {
      for (let i = 0; i < 30 && (await notices()) < expected; i++) await new Promise((r) => setTimeout(r, 100));
      return notices();
    };

    // Off by default: the earn is written, no message.
    const quiet = await complete();
    expect(await ctx.prisma.loyaltyTransaction.count({ where: { orderId: quiet, type: 'EARN' } })).toBe(1);
    await new Promise((r) => setTimeout(r, 300));
    expect(await notices()).toBe(0);

    const saved = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/loyalty`)
      .set(owner)
      .send({ ...program, notifyEarned: true });
    expect(saved.status).toBe(200);
    expect(saved.body.notifyEarned).toBe(true);
    const told = await complete();
    expect(await settle(1)).toBe(1);
    const earn = await ctx.prisma.loyaltyTransaction.findFirstOrThrow({ where: { orderId: told, type: 'EARN' } });
    expect(earn.notifiedAt).not.toBeNull();
    // Another publish of the same completed order sends nothing more.
    await ctx.app.get(LoyaltyEarnedNotifier).onOrder({ id: told, restaurantId, status: 'PICKED_UP' });
    expect(await notices()).toBe(1);

    await ctx.http().put(`/restaurants/${restaurantId}/loyalty`).set(owner).send(program).expect(200);
  });

  it('multiplies earned points by the spend tier and shows the tier to the customer and the restaurant', async () => {
    const owner = bearer(ownerToken, restaurantId);
    const lifetime = async (): Promise<number> =>
      (
        await ctx.prisma.restaurantCustomer.findFirstOrThrow({
          where: { restaurantId, user: { phone } },
          select: { lifetimeGrossMinor: true },
        })
      ).lifetimeGrossMinor;
    const start = await lifetime();
    const silverMin = Math.max(1, start);
    const goldMin = start + 2 * itemPriceMinor + 1_000_000;

    // Thresholds must rise.
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/loyalty`)
      .set(owner)
      .send({
        ...program,
        tiers: [
          { name: 'Gold', minSpendMinor: goldMin, earnMultiplierPct: 300 },
          { name: 'Silver', minSpendMinor: silverMin, earnMultiplierPct: 200 },
        ],
      })
      .expect(400);
    const saved = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/loyalty`)
      .set(owner)
      .send({
        ...program,
        tiers: [
          { name: 'Silver', minSpendMinor: silverMin, earnMultiplierPct: 200 },
          { name: 'Gold', minSpendMinor: goldMin, earnMultiplierPct: 300 },
        ],
      })
      .expect(200);
    expect(saved.body.tiers).toHaveLength(2);

    const before = await balance();
    const placed = await publicOrder({}).expect(201);
    const orderId = await orderIdOf(placed.body.trackingToken);
    await transition(orderId, 'ACCEPTED', { prepMinutes: 5 });
    await transition(orderId, 'READY');
    await transition(orderId, 'PICKED_UP');
    const earned = Math.floor((Math.floor((2 * itemPriceMinor) / 100) * 200) / 100);
    expect(await balance()).toBe(before + earned);
    const row = await ctx.prisma.loyaltyTransaction.findFirstOrThrow({ where: { orderId, type: 'EARN' } });
    expect(row.points).toBe(earned);
    expect(row.memo).toContain('Silver');

    const customerToken = await ctx.login(phone);
    const viewer = await ctx
      .http()
      .get(`/me/viewer?restaurantId=${restaurantId}`)
      .set(bearer(customerToken))
      .expect(200);
    expect(viewer.body.loyaltyTier).toEqual({ name: 'Silver', earnMultiplierPct: 200 });
    const account = await ctx.http().get('/me/account').set(bearer(customerToken)).expect(200);
    const mine = account.body.loyalty.find(
      (b: { restaurant: { slug: string } }) => b.restaurant.slug === SEED.restaurantSlug,
    );
    expect(mine.tier).toBe('Silver');
    expect(mine.nextTier).toEqual({ name: 'Gold', remainingMinor: goldMin - (await lifetime()) });

    const list = await ctx.http().get(`/restaurants/${restaurantId}/customers?query=Sadik`).set(owner).expect(200);
    expect(list.body.items[0].loyaltyTier).toBe('Silver');

    // Without tiers everyone earns at the base rate again.
    await ctx.http().put(`/restaurants/${restaurantId}/loyalty`).set(owner).send(program).expect(200);
    const plain = await ctx
      .http()
      .get(`/me/viewer?restaurantId=${restaurantId}`)
      .set(bearer(customerToken))
      .expect(200);
    expect(plain.body.loyaltyTier).toBeNull();
  });

  it('lets staff adjust a balance within limits, shows it on the customer, and closes everything to BASIC', async () => {
    const customer = await ctx.prisma.restaurantCustomer.findFirstOrThrow({
      where: { restaurantId, user: { phone } },
      select: { id: true, loyaltyPoints: true },
    });
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/loyalty/customers/${customer.id}/adjust`)
      .set(bearer(ownerToken, restaurantId))
      .send({ points: -(customer.loyaltyPoints + 1), memo: 'too much' })
      .expect(409)
      .expect('x-error-code', 'LOYALTY_INSUFFICIENT_POINTS');
    const adjusted = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/loyalty/customers/${customer.id}/adjust`)
      .set(bearer(ownerToken, restaurantId))
      .send({ points: 5, memo: 'goodwill' })
      .expect(200);
    expect(adjusted.body.points).toBe(customer.loyaltyPoints + 5);
    expect(adjusted.body.transactions[0]).toMatchObject({ type: 'ADJUSTMENT', points: 5, memo: 'goodwill' });

    const list = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/customers?query=Sadik`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(list.body.items[0].loyaltyPoints).toBe(customer.loyaltyPoints + 5);

    // BASIC: the rules cannot change, the storefront hides the program and nothing is earned or spent.
    if (!subscriptionId) return;
    await ctx.prisma.restaurantSubscription.update({
      where: { id: subscriptionId },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    });
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/loyalty`)
      .set(bearer(ownerToken, restaurantId))
      .send(program)
      .expect(403)
      .expect('x-error-code', 'PLAN_FEATURE_REQUIRED');
    const overview = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/loyalty`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(overview.body.program.enabled).toBe(true);
    expect(overview.body.program.active).toBe(false);
    const menu = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200);
    expect(menu.body.loyalty).toBeNull();
    const customerToken = await ctx.login(phone);
    await publicOrder({ useLoyaltyPoints: true }, customerToken)
      .expect(409)
      .expect('x-error-code', 'LOYALTY_NOT_ACTIVE');
    const placed = await publicOrder({}).expect(201);
    const orderId = await orderIdOf(placed.body.trackingToken);
    await transition(orderId, 'ACCEPTED', { prepMinutes: 5 });
    await transition(orderId, 'READY');
    await transition(orderId, 'PICKED_UP');
    expect(await balance()).toBe(customer.loyaltyPoints + 5);
    await ctx.prisma.restaurantSubscription.update({ where: { id: subscriptionId }, data: { trialEndsAt } });
  });
});
