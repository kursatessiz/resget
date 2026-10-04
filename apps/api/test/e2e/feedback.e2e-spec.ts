import type { FeedbackCaseDTO, FeedbackOverviewDTO, OrderTrackingDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const REVIEW_URL = 'https://g.page/r/demo-lokanta/review';

/** Feedback routing and NPS (docs/GERI_BILDIRIM.md): switch, ungated review link, low-rating cases, NPS once, summary. */
describe('Feedback and NPS (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let menuItemId: string;
  let ratingSumBefore = 0;
  let ratingCountBefore = 0;
  const orderIds: string[] = [];
  const owner = () => bearer(ownerToken, restaurantId);
  const setSwitch = (enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/feedback`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);

  /** A phone order taken by the staff, completed, ready to be rated from its tracking page. */
  const completedOrder = async () => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity: 1 }],
        customer: { fullName: 'Geri Bildirim', phone: '05329990971' },
      })
      .expect(201);
    const id = res.body.id as string;
    orderIds.push(id);
    for (const to of ['ACCEPTED', 'READY', 'PICKED_UP']) {
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/orders/${id}/transition`)
        .set(owner())
        .send({ to, ...(to === 'ACCEPTED' ? { prepMinutes: 5 } : {}) })
        .expect(200);
    }
    return { id, token: (res.body.trackingUrl as string).split('/t/')[1] };
  };
  const rate = async (token: string, score: number, comment?: string) =>
    (
      await ctx
        .http()
        .post(`/public/orders/${token}/rating`)
        .send({ score, ...(comment ? { comment } : {}) })
        .expect(201)
    ).body as OrderTrackingDTO;

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, ratingSum: true, ratingCount: true, branches: { take: 1, select: { id: true } } },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    ratingSumBefore = restaurant.ratingSum;
    ratingCountBefore = restaurant.ratingCount;
    menuItemId = (
      await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, isAvailable: true }, select: { id: true } })
    ).id;
  });

  afterAll(async () => {
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { ratingSum: ratingSumBefore, ratingCount: ratingCountBefore },
    });
    await ctx.prisma.feedbackSettings.deleteMany({ where: { restaurantId } });
    await ctx.prisma.featureFlag.deleteMany({ where: { key: 'feedback' } });
    await ctx.prisma.auditLog.deleteMany({ where: { action: 'feedback.settings' } });
    await ctx.close();
  });

  it('does nothing while the module is off', async () => {
    const off = await ctx.http().get(`/restaurants/${restaurantId}/feedback/settings`).set(owner()).expect(403);
    expect(off.body.code).toBe('FEATURE_DISABLED');
    const order = await completedOrder();
    const tracking = await rate(order.token, 1, 'Soguktu');
    expect(tracking).toMatchObject({ reviewUrl: null, nps: null, canAnswerNps: false });
    expect(await ctx.prisma.feedbackCase.findUnique({ where: { orderId: order.id } })).toBeNull();
  });

  it('offers the review page to every rater and asks NPS once', async () => {
    await setSwitch(true);
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/feedback/settings`)
      .set(owner())
      .send({ reviewUrl: 'http://insecure.test/review', alertMaxScore: 2, npsEnabled: true })
      .expect(400);
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/feedback/settings`)
      .set(owner())
      .send({ reviewUrl: REVIEW_URL, alertMaxScore: 2, npsEnabled: true })
      .expect(200);

    // NPS waits for a completed order; the review link waits for the rating.
    const fresh = await completedOrder();
    const before = (await ctx.http().get(`/public/orders/${fresh.token}`).expect(200)).body as OrderTrackingDTO;
    expect(before).toMatchObject({ reviewUrl: null, canAnswerNps: true });

    const happy = await rate(fresh.token, 5);
    expect(happy.reviewUrl).toBe(REVIEW_URL);
    const answered = (
      await ctx
        .http()
        .post(`/public/orders/${fresh.token}/nps`)
        .send({ score: 9, comment: 'Hizli ve sicak' })
        .expect(201)
    ).body as OrderTrackingDTO;
    expect(answered).toMatchObject({ nps: { score: 9 }, canAnswerNps: false });
    const again = await ctx.http().post(`/public/orders/${fresh.token}/nps`).send({ score: 3 }).expect(409);
    expect(again.body.code).toBe('NPS_EXISTS');
    await ctx.http().post(`/public/orders/${fresh.token}/nps`).send({ score: 11 }).expect(400);
  });

  it('turns a low rating into a case the staff resolve, and still shows the review link', async () => {
    const order = await completedOrder();
    const unhappy = await rate(order.token, 2, 'Eksik geldi');
    // The same link whatever the score: no review gating.
    expect(unhappy.reviewUrl).toBe(REVIEW_URL);
    const open = (
      await ctx.http().get(`/restaurants/${restaurantId}/feedback/cases?status=OPEN`).set(owner()).expect(200)
    ).body as FeedbackCaseDTO[];
    const found = open.find((c) => c.orderId === order.id)!;
    expect(found).toMatchObject({ score: 2, comment: 'Eksik geldi', status: 'OPEN' });
    // Users are global: the phone may already carry another name, so the contact is checked by phone.
    expect(found.customer?.phone).toMatch(/5329990971$/);

    const resolved = (
      await ctx
        .http()
        .patch(`/restaurants/${restaurantId}/feedback/cases/${found.id}`)
        .set(owner())
        .send({ status: 'RESOLVED', note: 'Aradik, bir sonraki siparis ikram' })
        .expect(200)
    ).body as FeedbackCaseDTO;
    expect(resolved).toMatchObject({ status: 'RESOLVED', note: 'Aradik, bir sonraki siparis ikram' });
    expect(resolved.resolvedAt).not.toBeNull();
    const stillOpen = (
      await ctx.http().get(`/restaurants/${restaurantId}/feedback/cases?status=OPEN`).set(owner()).expect(200)
    ).body as FeedbackCaseDTO[];
    expect(stillOpen.map((c) => c.id)).not.toContain(found.id);

    // A score above the threshold opens nothing.
    const fine = await completedOrder();
    await rate(fine.token, 3);
    expect(await ctx.prisma.feedbackCase.findUnique({ where: { orderId: fine.id } })).toBeNull();
  });

  it('summarises ratings and NPS for the period', async () => {
    const overview = (
      await ctx.http().get(`/restaurants/${restaurantId}/feedback/overview?days=30`).set(owner()).expect(200)
    ).body as FeedbackOverviewDTO;
    expect(overview.ratings.count).toBeGreaterThanOrEqual(4);
    expect(overview.ratings.distribution['5']).toBeGreaterThanOrEqual(1);
    expect(overview.nps).toMatchObject({ score: 100, promoters: 1, passives: 0, detractors: 0 });
    expect(overview.nps.comments[0]).toMatchObject({ score: 9, comment: 'Hizli ve sicak' });
    await ctx.http().get(`/restaurants/${restaurantId}/feedback/overview?days=7`).set(owner()).expect(400);
  });
});
