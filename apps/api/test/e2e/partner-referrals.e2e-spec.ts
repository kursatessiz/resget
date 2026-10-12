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
  const SYBIL_OWNER = `05353${stamp}`;
  const RACE_OWNERS = [`05391${stamp}`, `05392${stamp}`, `05393${stamp}`];

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
  const menuItems = new Map<string, string>();
  let customerCounter = 0;
  let addressCounter = 0;
  /** A phone number no one has used: the guest customer of a public order. */
  const nextCustomerPhone = () => `0538${stamp.slice(-5)}${String(customerCounter++).padStart(2, '0')}`;
  /** Opens a menu item once per restaurant, as its owner. */
  const menuItemOf = async (restaurant: RestaurantCreatedDTO, token: string): Promise<string> => {
    const known = menuItems.get(restaurant.id);
    if (known) return known;
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
    menuItems.set(restaurant.id, item.body.id as string);
    return item.body.id as string;
  };
  const transition = (restaurantId: string, token: string, orderId: string, to: string) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${orderId}/transition`)
      .set(bearer(token, restaurantId))
      .send({ to, ...(to === 'ACCEPTED' ? { prepMinutes: 5 } : {}) });
  /** Places a pickup order for the phone and takes it to READY; the last step is left to the caller. */
  const placeReadyOrder = async (restaurant: RestaurantCreatedDTO, token: string, phone: string): Promise<string> => {
    const menuItemId = await menuItemOf(restaurant, token);
    const placed = await ctx
      .http()
      .post(`/public/restaurants/${restaurant.slug}/orders`)
      // The public order budget is per client address; every order comes from its own.
      .set('x-forwarded-for', `198.51.100.${(addressCounter += 1)}`)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity: 1 }],
        customer: { fullName: 'Misafir Musteri', phone },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(201);
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: placed.body.trackingToken } });
    for (const to of ['ACCEPTED', 'READY']) await transition(restaurant.id, token, order.id, to).expect(200);
    return order.id;
  };
  /**
   * Completes one pickup order per entry as the restaurant's owner. A number is that many orders from new, distinct
   * guests; a phone is a guest by that number; null is an order with no customer on file (entered by staff).
   */
  const completeOrders = async (
    restaurant: RestaurantCreatedDTO,
    token: string,
    customers: number | (string | null)[],
  ) => {
    const list =
      typeof customers === 'number' ? Array.from({ length: customers }, () => nextCustomerPhone()) : customers;
    for (const customer of list) {
      const orderId = await placeReadyOrder(restaurant, token, customer ?? nextCustomerPhone());
      if (customer === null) await ctx.prisma.order.update({ where: { id: orderId }, data: { customerUserId: null } });
      await transition(restaurant.id, token, orderId, 'PICKED_UP').expect(200);
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
      where: {
        OR: [
          { phone: { in: [NEW_OWNER_1, NEW_OWNER_2, SYBIL_OWNER, ...RACE_OWNERS].map((p) => normalizePhone(p)!) } },
          { phone: { startsWith: `+90538${stamp.slice(-5)}` } },
        ],
      },
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
    const secondReferral = await ctx.prisma.partnerReferral.findUnique({ where: { refereeRestaurantId: second.id } });
    expect(secondReferral).not.toBeNull();
    // That owner's second restaurant got no sign-up trial (docs/PLAN_MATRISI.md), so the link carries no bonus days.
    expect(secondReferral?.refereeBonusDays).toBe(0);
    expect((await subscriptionOf(second.id)).plan.code).toBe('BASIC');
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

  it('rewards only for completed orders from distinct customers outside both restaurants', async () => {
    await config({ qualifyingOrders: 2, yearlyCapPerReferrer: 9 });
    const mine = (await ctx.http().get(`/restaurants/${referrerId}/partner-referrals`).set(owner()).expect(200))
      .body as MyPartnerReferralsDTO;
    const token = await ctx.login(SYBIL_OWNER);
    const sybil = await signup(token, mine.code!);
    const statusOf = async () =>
      (await ctx.prisma.partnerReferral.findUniqueOrThrow({ where: { refereeRestaurantId: sybil.id } })).status;
    const guest = nextCustomerPhone();

    // One customer ordering again and again is one customer.
    await completeOrders(sybil, token, [guest, guest, guest]);
    expect(await statusOf()).toBe('PENDING');
    // The new restaurant's own owner and the referrer's owner ordering are insiders, whatever number of orders.
    await completeOrders(sybil, token, [SYBIL_OWNER, SEED.ownerPhone, SYBIL_OWNER, SEED.ownerPhone]);
    expect(await statusOf()).toBe('PENDING');
    // Orders with no customer on file count for nothing.
    await completeOrders(sybil, token, [null, null]);
    expect(await statusOf()).toBe('PENDING');
    // The progress shown to the referrer is the same measure.
    const progress = (await ctx.http().get(`/restaurants/${referrerId}/partner-referrals`).set(owner()).expect(200))
      .body as MyPartnerReferralsDTO;
    expect(
      progress.referrals.find((r) => r.restaurantName === `Davetli ${stamp} ${createdRestaurants.indexOf(sybil.id)}`),
    ).toMatchObject({ completedOrders: 1 });

    // A second real customer completes the requirement.
    await completeOrders(sybil, token, 1);
    expect(await statusOf()).toBe('REWARDED');
  });

  it('keeps the yearly cap when referees of one referrer complete at the same moment', async () => {
    const rewardedBefore = await ctx.prisma.partnerReferral.count({
      where: { referrerRestaurantId: referrerId, status: 'REWARDED' },
    });
    await config({ qualifyingOrders: 1, yearlyCapPerReferrer: rewardedBefore + 1 });
    const mine = (await ctx.http().get(`/restaurants/${referrerId}/partner-referrals`).set(owner()).expect(200))
      .body as MyPartnerReferralsDTO;
    const referees = [];
    for (const phone of RACE_OWNERS) {
      const token = await ctx.login(phone);
      const restaurant = await signup(token, mine.code!);
      referees.push({ restaurant, token, orderId: await placeReadyOrder(restaurant, token, nextCustomerPhone()) });
    }
    const finals = await Promise.all(referees.map((r) => transition(r.restaurant.id, r.token, r.orderId, 'PICKED_UP')));
    expect(finals.map((f) => f.status)).toEqual([200, 200, 200]);
    const rows = await ctx.prisma.partnerReferral.findMany({
      where: { refereeRestaurantId: { in: referees.map((r) => r.restaurant.id) } },
      select: { status: true },
    });
    expect(rows.map((r) => r.status).sort()).toEqual(['CAPPED', 'CAPPED', 'REWARDED']);
    expect(
      await ctx.prisma.partnerReferral.count({ where: { referrerRestaurantId: referrerId, status: 'REWARDED' } }),
    ).toBe(rewardedBefore + 1);
  });
});
