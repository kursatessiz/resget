import type { MyReferralDTO, ReferralProgramDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Customer referrals (docs/TAVSIYE.md): programme, personal code, friend discount, reward, cap, own-code and owner rules. */
describe('Customer referrals (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let referrerToken: string;
  let restaurantId: string;
  let itemId: string;
  const created: string[] = [];
  const REFERRER = '05329990951';
  // Phones that never ordered here, fresh on every run (customer rows outlive the orders this spec deletes).
  const stamp = String(Date.now()).slice(-6);
  const FRIEND_1 = `05341${stamp}`;
  const FRIEND_2 = `05342${stamp}`;
  const FRIEND_3 = `05343${stamp}`;

  const owner = () => bearer(ownerToken, restaurantId);
  const setSwitch = (key: string, enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/${key}`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const program = (body: Record<string, unknown> = {}) => ({
    isActive: true,
    friendKind: 'PERCENT',
    friendPercentBps: 2000,
    friendMaxDiscountMinor: 10000,
    friendMinBasketMinor: 0,
    rewardAmountMinor: 5000,
    rewardValidDays: 30,
    monthlyCapPerReferrer: 1,
    ...body,
  });
  /** The same programme with a fixed friend discount instead of a percent. */
  const amountProgram = (isActive: boolean) => {
    const { friendPercentBps: _p, friendMaxDiscountMinor: _m, ...rest } = program({ isActive });
    return { ...rest, friendKind: 'AMOUNT', friendAmountMinor: 3000 };
  };
  /** Two koftes: 840.00. */
  const pickup = async (phone: string, couponCode: string | undefined, expected: number) => {
    const res = await ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 2 }],
        customer: { fullName: 'Tavsiye Musteri', phone },
        payment: { method: 'CASH_ON_DELIVERY' },
        ...(couponCode ? { couponCode } : {}),
      })
      .expect(expected);
    if (res.status !== 201) return Object.assign(res, { orderId: '' });
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: res.body.trackingToken } });
    created.push(order.id);
    return Object.assign(res, { orderId: order.id });
  };
  const transition = (id: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${id}/transition`)
      .set(owner())
      .send({ to, ...extra })
      .expect(200);
  const complete = async (id: string) => {
    await transition(id, 'ACCEPTED', { prepMinutes: 5 });
    await transition(id, 'READY');
    await transition(id, 'PICKED_UP');
  };
  const mine = async (): Promise<MyReferralDTO | undefined> =>
    ((await ctx.http().get('/me/referrals').set(bearer(referrerToken)).expect(200)).body as MyReferralDTO[]).find(
      (r) => r.restaurantId === restaurantId,
    );

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    restaurantId = (
      await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug }, select: { id: true } })
    ).id;
    itemId = (await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, name: 'Izgara kofte' } })).id;
    await setSwitch('coupons', true);
  });

  afterAll(async () => {
    if (created.length) await ctx.prisma.order.deleteMany({ where: { id: { in: created } } });
    await ctx.prisma.coupon.deleteMany({ where: { restaurantId, source: { not: 'MANUAL' } } });
    await ctx.prisma.referralProgram.deleteMany({ where: { restaurantId } });
    await ctx.prisma.featureFlag.deleteMany({ where: { key: { in: ['coupons', 'referrals'] } } });
    await ctx.prisma.auditLog.deleteMany({ where: { action: 'referral_program.update' } });
    await ctx.close();
  });

  it('ships switched off and starts with no programme', async () => {
    const off = await ctx.http().get(`/restaurants/${restaurantId}/referrals/program`).set(owner()).expect(403);
    expect(off.body.code).toBe('FEATURE_DISABLED');
    await setSwitch('referrals', true);
    const none = await ctx.http().get(`/restaurants/${restaurantId}/referrals/program`).set(owner()).expect(200);
    expect(none.body).toEqual({ program: null });
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/referrals/program`)
      .set(owner())
      .send(program({ rewardValidDays: 1 }))
      .expect(400);
    const saved = (
      await ctx.http().put(`/restaurants/${restaurantId}/referrals/program`).set(owner()).send(program()).expect(200)
    ).body as ReferralProgramDTO;
    expect(saved).toMatchObject({
      isActive: true,
      friendKind: 'PERCENT',
      friendPercentBps: 2000,
      rewardAmountMinor: 5000,
    });
    expect(saved.stats).toMatchObject({ codes: 0, friendOrders: 0, rewardsGranted: 0 });
  });

  it('gives a code only to someone who has ordered, and never lets them use it themselves', async () => {
    await pickup(REFERRER, undefined, 201);
    referrerToken = await ctx.login(REFERRER);
    const before = await mine();
    expect(before).toMatchObject({ code: null, rewardAmountMinor: 5000, rewards: [] });
    const withCode = (
      await ctx.http().post(`/me/referrals/${restaurantId}/code`).set(bearer(referrerToken)).expect(200)
    ).body as MyReferralDTO;
    expect(withCode.code).toMatch(/^R[2-9A-HJ-NP-Z]{7}$/);
    // Asking again returns the same code.
    const again = (await ctx.http().post(`/me/referrals/${restaurantId}/code`).set(bearer(referrerToken)).expect(200))
      .body as MyReferralDTO;
    expect(again.code).toBe(withCode.code);

    const own = await pickup(REFERRER, withCode.code!, 409);
    expect(own.body.code).toBe('COUPON_OWN_REFERRAL');
    // Personal codes are not manual coupons: the coupons list stays clean.
    const coupons = await ctx.http().get(`/restaurants/${restaurantId}/coupons`).set(owner()).expect(200);
    expect((coupons.body as { code: string }[]).map((c) => c.code)).not.toContain(withCode.code);
  });

  it("discounts a friend's first order and rewards the referrer when it completes", async () => {
    const code = (await mine())!.code!;
    // 20 percent of 840.00 is 168.00, capped at 100.00.
    const friend = await pickup(FRIEND_1, code, 201);
    expect(friend.body.discountMinor).toBe(10000);
    // Only a first order: the same friend cannot use it twice.
    await complete(friend.orderId);
    const second = await pickup(FRIEND_1, code, 409);
    expect(second.body.code).toBe('COUPON_FIRST_ORDER_ONLY');

    const after = (await mine())!;
    expect(after.rewards).toHaveLength(1);
    const reward = after.rewards[0];
    expect(reward).toMatchObject({ amountMinor: 5000, used: false });
    expect(reward.code).toMatch(/^W/);

    // The reward is the referrer's alone.
    const stranger = await pickup(FRIEND_2, reward.code, 404);
    expect(stranger.body.code).toBe('COUPON_NOT_FOUND');
    const used = await pickup(REFERRER, reward.code, 201);
    expect(used.body.discountMinor).toBe(5000);
    expect((await mine())!.rewards[0].used).toBe(true);
  });

  it('keeps the friend discount but skips the reward over the cap, and gives nothing for a cancelled order', async () => {
    const code = (await mine())!.code!;
    const capped = await pickup(FRIEND_2, code, 201);
    await complete(capped.orderId);
    const reward = await ctx.prisma.referralReward.findUniqueOrThrow({ where: { orderId: capped.orderId } });
    expect(reward).toMatchObject({ status: 'SKIPPED_CAP', rewardCouponId: null });
    expect((await mine())!.rewards).toHaveLength(1);

    const cancelled = await pickup(FRIEND_3, code, 201);
    await transition(cancelled.orderId, 'REJECTED', { reason: 'closed' });
    expect(await ctx.prisma.referralReward.findUnique({ where: { orderId: cancelled.orderId } })).toBeNull();

    const stats = (await ctx.http().get(`/restaurants/${restaurantId}/referrals/program`).set(owner()).expect(200)).body
      .program as ReferralProgramDTO;
    expect(stats.stats).toMatchObject({
      codes: 1,
      friendOrders: 2,
      friendDiscountMinor: 20000,
      rewardsGranted: 1,
      rewardsSkipped: 1,
      rewardValueMinor: 5000,
      rewardsUsed: 1,
    });
  });

  it('stops personal codes while the programme is paused and carries new terms onto them', async () => {
    const code = (await mine())!.code!;
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/referrals/program`)
      .set(owner())
      .send(amountProgram(false))
      .expect(200);
    await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/coupons/${code}`).expect(404);
    expect(await mine()).toBeUndefined();
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/referrals/program`)
      .set(owner())
      .send(amountProgram(true))
      .expect(200);
    const shown = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/coupons/${code}`).expect(200);
    expect(shown.body).toMatchObject({ kind: 'AMOUNT', amountMinor: 3000, firstOrderOnly: true });
  });
});
