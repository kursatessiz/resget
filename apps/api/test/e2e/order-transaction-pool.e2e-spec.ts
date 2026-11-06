import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp, withConnectionLimit } from './support/app';
import type { TestContext } from './support/app';
import { EntitlementsService } from '../../src/modules/features/entitlements.service';
import { FeatureFlagsService } from '../../src/modules/features/feature-flags.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

/**
 * An order transition runs every query of its transaction on that transaction (docs/SIPARIS_VE_SEVK.md). A hook
 * that reached for the root client needed a second pooled connection while the transaction held one, so once
 * concurrent transitions filled the pool every one of them timed out. This app gets a pool of one connection:
 * any such query left inside the transaction waits for a connection that never frees, and the transition fails.
 */
describe('Order transitions on a one-connection pool (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let currency: string;
  let itemId: string;
  const created: string[] = [];
  const stamp = String(Date.now()).slice(-6);
  const REFERRER = `05361${stamp}`;
  const FRIEND = `05362${stamp}`;
  const SECOND = `05363${stamp}`;
  let journeyId: string;
  let couponId: string;
  let loyaltyBefore: { enabled: boolean; welcomePoints: number } | null = null;
  let clientSeq = 0;

  const owner = () => bearer(ownerToken, restaurantId);
  const setSwitch = (key: string, enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/${key}`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const pickup = async (phone: string): Promise<string> => {
    clientSeq += 1;
    const res = await ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .set('x-forwarded-for', `10.97.${stamp.slice(-2)}.${clientSeq}`)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 1 }],
        customer: { fullName: 'Havuz Musteri', phone },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(201);
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: res.body.trackingToken } });
    created.push(order.id);
    return order.id;
  };
  const transition = (id: string, to: string) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${id}/transition`)
      .set(owner())
      .send({ to, ...(to === 'ACCEPTED' ? { prepMinutes: 5 } : {}) });
  const customerOf = async (phone: string) =>
    ctx.prisma.restaurantCustomer.findFirstOrThrow({
      where: { restaurantId, user: { phone: normalizePhone(phone)! } },
      select: { id: true },
    });

  beforeAll(async () => {
    const shared = process.env.DATABASE_URL!;
    process.env.DATABASE_URL = withConnectionLimit(shared, 1);
    try {
      ctx = await createTestApp();
    } finally {
      process.env.DATABASE_URL = shared;
    }
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    ({ id: restaurantId, currency } = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, currency: true },
    }));
    itemId = (await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, name: 'Izgara kofte' } })).id;
    for (const key of ['coupons', 'referrals', 'journeys', 'loyalty']) await setSwitch(key, true);
    const loyalty = await ctx.prisma.loyaltyProgram.findUnique({ where: { restaurantId } });
    loyaltyBefore = loyalty ? { enabled: loyalty.enabled, welcomePoints: loyalty.welcomePoints } : null;
    await ctx.prisma.loyaltyProgram.upsert({
      where: { restaurantId },
      create: { restaurantId, enabled: true, earnStepMinor: 100, redeemValueMinor: 1000, welcomePoints: 10 },
      update: { enabled: true, welcomePoints: 10 },
    });
    journeyId = (
      await ctx.prisma.journey.create({
        data: {
          restaurantId,
          name: `Havuz ${stamp}`,
          trigger: 'ORDER_COMPLETED',
          channel: 'SMS',
          body: 'Afiyet olsun',
          cooldownDays: 0,
          status: 'ACTIVE',
        },
      })
    ).id;
    await ctx.prisma.referralProgram.deleteMany({ where: { restaurantId } });
    await ctx.prisma.referralProgram.create({
      data: { restaurantId, isActive: true, friendKind: 'AMOUNT', friendAmountMinor: 0, rewardAmountMinor: 5000 },
    });
  });

  afterAll(async () => {
    if (created.length) await ctx.prisma.order.deleteMany({ where: { id: { in: created } } });
    if (couponId)
      await ctx.prisma.coupon.deleteMany({
        where: { OR: [{ id: couponId }, { restaurantId, source: 'REFERRAL_REWARD' }] },
      });
    if (journeyId) await ctx.prisma.journey.deleteMany({ where: { id: journeyId } });
    await ctx.prisma.referralProgram.deleteMany({ where: { restaurantId } });
    if (loyaltyBefore) await ctx.prisma.loyaltyProgram.update({ where: { restaurantId }, data: loyaltyBefore });
    else await ctx.prisma.loyaltyProgram.deleteMany({ where: { restaurantId } });
    await ctx.prisma.featureFlag.deleteMany({
      where: { restaurantId, key: { in: ['coupons', 'referrals', 'journeys', 'loyalty'] } },
    });
    await ctx.close();
  });

  it('completes and cancels orders with loyalty, journeys, referrals and coupons active', async () => {
    // The referrer's own order: cancelled below, which gives its coupon use and stock back and recounts the customer.
    const referrerOrder = await pickup(REFERRER);
    const referrer = await customerOf(REFERRER);
    couponId = (
      await ctx.prisma.coupon.create({
        data: {
          restaurantId,
          code: `RPOOL${stamp}`,
          kind: 'AMOUNT',
          amountMinor: 0,
          source: 'REFERRAL',
          referrerCustomerId: referrer.id,
          perCustomerLimit: 1,
        },
      })
    ).id;
    const friendOrder = await pickup(FRIEND);
    const friend = await customerOf(FRIEND);
    await ctx.prisma.couponRedemption.create({
      data: { restaurantId, couponId, orderId: friendOrder, customerId: friend.id, discountMinor: 0, currency },
    });
    await ctx.prisma.couponRedemption.create({
      data: { restaurantId, couponId, orderId: referrerOrder, customerId: referrer.id, discountMinor: 0, currency },
    });

    for (const to of ['ACCEPTED', 'READY', 'PICKED_UP']) {
      const res = await transition(friendOrder, to);
      expect(res.status).toBe(200);
    }
    // Every completion hook did its work inside the transaction.
    expect(await ctx.prisma.loyaltyTransaction.count({ where: { orderId: friendOrder, type: 'EARN' } })).toBe(1);
    expect(await ctx.prisma.journeyRun.count({ where: { journeyId, orderId: friendOrder } })).toBe(1);
    expect(await ctx.prisma.referralReward.findUnique({ where: { orderId: friendOrder } })).toMatchObject({
      status: 'GRANTED',
      referrerCustomerId: referrer.id,
    });

    const cancelled = await transition(referrerOrder, 'CANCELLED_BY_RESTAURANT');
    expect(cancelled.status).toBe(200);
    expect(
      (await ctx.prisma.couponRedemption.findUniqueOrThrow({ where: { orderId: referrerOrder } })).releasedAt,
    ).not.toBeNull();
  });

  it('reloads stale module switches and plan rows on the transaction itself', async () => {
    const orderId = await pickup(SECOND);
    for (const to of ['ACCEPTED', 'READY']) expect((await transition(orderId, to)).status).toBe(200);
    // Nothing cached: the checks inside the transaction load the switches and the plans themselves.
    Object.assign(ctx.app.get(FeatureFlagsService), { snapshot: null });
    Object.assign(ctx.app.get(EntitlementsService), { snapshot: null });
    const orders = ctx.app.get(OrdersService);
    await ctx.app
      .get(PrismaService)
      .$transaction(async (tx) =>
        orders.applyTransition(tx, await orders.loadRow(tx, orderId), 'PICKED_UP', 'RESTAURANT', null),
      );
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('PICKED_UP');
    expect(await ctx.prisma.journeyRun.count({ where: { journeyId, orderId } })).toBe(1);
    expect(await ctx.prisma.loyaltyTransaction.count({ where: { orderId, type: 'EARN' } })).toBe(1);
  });
});
