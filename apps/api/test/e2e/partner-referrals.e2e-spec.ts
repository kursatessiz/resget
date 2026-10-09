import { normalizePhone, proExtension } from '@resget/shared';
import type { MyPartnerReferralsDTO, RestaurantCreatedDTO, SubscriptionState } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { deleteTestRestaurants } from './support/cleanup';

const DAY = 24 * 60 * 60 * 1000;

/** Restaurant-to-restaurant referrals (docs/RESTORAN_TAVSIYE.md): code, sign-up bonus, qualifying orders, cap, self-invite. */
describe('Restaurant referrals (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let referrerId: string;
  let savedSubscription: { trialEndsAt: Date | null; currentPeriodEnd: Date | null; status: string; planId: string };
  const createdRestaurants: string[] = [];
  const stamp = String(Date.now()).slice(-6);
  const NEW_OWNER_1 = `05351${stamp}`;
  const NEW_OWNER_2 = `05352${stamp}`;

  const owner = () => bearer(ownerToken, referrerId);
  const setSwitch = (enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${referrerId}/features/partner_referrals`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const config = (body: Record<string, unknown>) =>
    ctx
      .http()
      .put('/admin/partner-referrals/config')
      .set(bearer(adminToken))
      .send({
        isActive: true,
        referrerRewardDays: 30,
        refereeBonusDays: 15,
        qualifyingOrders: 2,
        yearlyCapPerReferrer: 1,
        ...body,
      })
      .expect(200);
  const signup = async (token: string, partnerCode?: string): Promise<RestaurantCreatedDTO> => {
    const res = await ctx
      .http()
      .post('/restaurants')
      .set(bearer(token))
      .send({
        name: `Davetli ${stamp} ${createdRestaurants.length}`,
        countryCode: 'TR',
        currency: 'TRY',
        timezone: 'Europe/Istanbul',
        defaultLocale: 'tr',
        branch: { addressLine: 'Moda Cad. No 1', city: 'Istanbul', district: 'Kadikoy' },
        ...(partnerCode ? { partnerCode } : {}),
      })
      .expect(201);
    createdRestaurants.push(res.body.id as string);
    return res.body as RestaurantCreatedDTO;
  };
  const subscriptionOf = async (restaurantId: string) =>
    ctx.prisma.restaurantSubscription.findUniqueOrThrow({
      where: { restaurantId },
      include: { plan: { select: { code: true } } },
    });
  const stateOf = async (restaurantId: string): Promise<SubscriptionState> => {
    const sub = await subscriptionOf(restaurantId);
    return {
      planCode: sub.plan.code === 'PRO' ? 'PRO' : 'BASIC',
      status: sub.status as SubscriptionState['status'],
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
    };
  };
  /** Opens a menu item and completes `count` pickup orders at a new restaurant as its owner. */
  const completeOrders = async (restaurant: RestaurantCreatedDTO, token: string, count: number) => {
    const auth = bearer(token, restaurant.id);
    const category = await ctx
      .http()
      .post(`/restaurants/${restaurant.id}/menu/categories`)
      .set(auth)
      .send({ name: 'Ana' })
      .expect(201);
    const item = await ctx
      .http()
      .post(`/restaurants/${restaurant.id}/menu/items`)
      .set(auth)
      .send({ categoryId: category.body.id, name: 'Mercimek', priceMinor: 9000, vatRateBps: 1000 })
      .expect(201);
    for (let i = 0; i < count; i++) {
      const placed = await ctx
        .http()
        .post(`/public/restaurants/${restaurant.slug}/orders`)
        .send({
          fulfillment: 'PICKUP',
          items: [{ menuItemId: item.body.id, quantity: 1 }],
          customer: { fullName: 'Ilk Musteri', phone: `05361${stamp}` },
          payment: { method: 'CASH_ON_DELIVERY' },
        })
        .expect(201);
      const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: placed.body.trackingToken } });
      for (const to of ['ACCEPTED', 'READY', 'PICKED_UP']) {
        await ctx
          .http()
          .post(`/restaurants/${restaurant.id}/orders/${order.id}/transition`)
          .set(auth)
          .send({ to, ...(to === 'ACCEPTED' ? { prepMinutes: 5 } : {}) })
          .expect(200);
      }
    }
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    referrerId = (
      await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug }, select: { id: true } })
    ).id;
    const sub = await subscriptionOf(referrerId);
    savedSubscription = {
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      status: sub.status,
      planId: sub.planId,
    };
  });

  afterAll(async () => {
    await deleteTestRestaurants(ctx.prisma, { id: { in: createdRestaurants } });
    await ctx.prisma.restaurant.update({ where: { id: referrerId }, data: { partnerCode: null } });
    await ctx.prisma.restaurantSubscription.update({
      where: { restaurantId: referrerId },
      data: { ...savedSubscription, status: savedSubscription.status as never },
    });
    await ctx.prisma.partnerReferralConfig.deleteMany({});
    await ctx.prisma.featureFlag.deleteMany({ where: { key: 'partner_referrals' } });
    await ctx.prisma.user.deleteMany({
      where: { phone: { in: [NEW_OWNER_1, NEW_OWNER_2].map((p) => normalizePhone(p)!) } },
    });
    await ctx.prisma.auditLog.deleteMany({ where: { action: { startsWith: 'partner_referral.' } } });
    await ctx.close();
  });

  it('ships switched off and only makes a code while the programme runs', async () => {
    const off = await ctx.http().get(`/restaurants/${referrerId}/partner-referrals`).set(owner()).expect(403);
    expect(off.body.code).toBe('FEATURE_DISABLED');
    await setSwitch(true);
    const mine = (await ctx.http().get(`/restaurants/${referrerId}/partner-referrals`).set(owner()).expect(200))
      .body as MyPartnerReferralsDTO;
    expect(mine).toMatchObject({ isActive: false, code: null, referrals: [] });
    const refused = await ctx.http().post(`/restaurants/${referrerId}/partner-referrals/code`).set(owner()).expect(404);
    expect(refused.body.code).toBe('REFERRAL_NOT_AVAILABLE');
    await ctx
      .http()
      .put('/admin/partner-referrals/config')
      .set(bearer(adminToken))
      .send({
        isActive: true,
        referrerRewardDays: 30,
        refereeBonusDays: 15,
        qualifyingOrders: 0,
        yearlyCapPerReferrer: 1,
      })
      .expect(400);
    await ctx.http().put('/admin/partner-referrals/config').set(bearer(ownerToken)).send({}).expect(403);
  });

  it('gives the new restaurant its bonus at sign-up and ignores a self-invite', async () => {
    await config({});
    const withCode = (
      await ctx.http().post(`/restaurants/${referrerId}/partner-referrals/code`).set(owner()).expect(200)
    ).body as MyPartnerReferralsDTO;
    expect(withCode.code).toMatch(/^P[2-9A-HJ-NP-Z]{7}$/);
    const invite = await ctx.http().get(`/public/partner-invites/${withCode.code!.toLowerCase()}`).expect(200);
    expect(invite.body).toEqual({ restaurantName: 'Demo Lokanta', refereeBonusDays: 15 });

    const pro = await ctx.prisma.plan.findFirstOrThrow({ where: { code: 'PRO' }, select: { trialDays: true } });
    const before = Date.now();
    const newcomer = await signup(await ctx.login(NEW_OWNER_1), withCode.code!);
    const referral = await ctx.prisma.partnerReferral.findUniqueOrThrow({
      where: { refereeRestaurantId: newcomer.id },
    });
    expect(referral).toMatchObject({ referrerRestaurantId: referrerId, status: 'PENDING', refereeBonusDays: 15 });
    const trialEnds = (await subscriptionOf(newcomer.id)).trialEndsAt!.getTime();
    expect(trialEnds - before).toBeGreaterThanOrEqual((pro.trialDays + 15) * DAY - 60_000);
    expect(trialEnds - before).toBeLessThanOrEqual((pro.trialDays + 15) * DAY + 60_000);

    // The referrer's own owner opening a second restaurant with the code is not a referral.
    const own = await signup(ownerToken, withCode.code!);
    expect(await ctx.prisma.partnerReferral.findUnique({ where: { refereeRestaurantId: own.id } })).toBeNull();
    // An unknown code never fails a sign-up.
    const plain = await signup(await ctx.login(NEW_OWNER_2), 'P2222222');
    expect(await ctx.prisma.partnerReferral.findUnique({ where: { refereeRestaurantId: plain.id } })).toBeNull();
  });

  it('rewards the referrer once the new restaurant completes its qualifying orders, within the yearly cap', async () => {
    const newcomerId = createdRestaurants[0];
    const newcomer = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { id: newcomerId },
      select: { id: true, slug: true, name: true },
    });
    const token = await ctx.login(NEW_OWNER_1);
    const before = await stateOf(referrerId);
    await completeOrders(newcomer, token, 1);
    expect(
      (await ctx.prisma.partnerReferral.findUniqueOrThrow({ where: { refereeRestaurantId: newcomerId } })).status,
    ).toBe('PENDING');
    const rewardedAt = new Date();
    await completeOrders(newcomer, token, 1);
    const referral = await ctx.prisma.partnerReferral.findUniqueOrThrow({ where: { refereeRestaurantId: newcomerId } });
    expect(referral).toMatchObject({ status: 'REWARDED', rewardDays: 30 });

    // The referrer's subscription moved exactly as proExtension says; commission is untouched.
    const expected = proExtension(before, 30, rewardedAt);
    const after = await stateOf(referrerId);
    if (expected.kind === 'TRIAL' || expected.kind === 'RESTART_TRIAL') {
      expect(Math.abs(after.trialEndsAt!.getTime() - expected.trialEndsAt.getTime())).toBeLessThan(60_000);
    } else if (expected.kind === 'PERIOD') {
      expect(after.currentPeriodEnd!.getTime()).toBe(expected.currentPeriodEnd.getTime());
    }

    const mine = (await ctx.http().get(`/restaurants/${referrerId}/partner-referrals`).set(owner()).expect(200))
      .body as MyPartnerReferralsDTO;
    expect(mine.rewardDaysEarned).toBe(30);
    expect(mine.referrals[0]).toMatchObject({ restaurantName: newcomer.name, status: 'REWARDED', completedOrders: 2 });

    // A second restaurant joins with the same code; the yearly cap of one is reached already.
    const second = await signup(await ctx.login(NEW_OWNER_2), mine.code!);
    expect(await ctx.prisma.partnerReferral.findUnique({ where: { refereeRestaurantId: second.id } })).not.toBeNull();
  });

  it('caps the referrer and lists every invitation in the console', async () => {
    const secondId = createdRestaurants[createdRestaurants.length - 1];
    const second = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { id: secondId },
      select: { id: true, slug: true, name: true },
    });
    await completeOrders(second, await ctx.login(NEW_OWNER_2), 2);
    const capped = await ctx.prisma.partnerReferral.findUniqueOrThrow({ where: { refereeRestaurantId: secondId } });
    expect(capped).toMatchObject({ status: 'CAPPED', rewardDays: null });

    const list = await ctx.http().get('/admin/partner-referrals').set(bearer(adminToken)).expect(200);
    const statuses = (list.body as { referee: { id: string }; status: string }[])
      .filter((r) => createdRestaurants.includes(r.referee.id))
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual(['CAPPED', 'REWARDED']);
  });
});
