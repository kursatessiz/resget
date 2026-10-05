import type { AdminReviewDTO, PanelReviewsPageDTO, PublicReviewsPageDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Public reviews: the restaurant page, the customer's edit, the answer, reports and moderation (docs/YORUMLAR.md). */
describe('Public reviews (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let menuItemId: string;
  const orderIds: string[] = [];
  let ratingSumBefore = 0;
  let ratingCountBefore = 0;
  const owner = () => bearer(ownerToken, restaurantId);

  const ratedOrder = async (fullName: string, score: number, comment?: string) => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity: 1 }],
        customer: {
          fullName,
          phone: `05327${String(Date.now()).slice(-4)}${String(orderIds.length).padStart(2, '0')}`,
        },
      })
      .expect(201);
    const id = res.body.id as string;
    orderIds.push(id);
    for (const step of [{ to: 'ACCEPTED', prepMinutes: 5 }, { to: 'READY' }, { to: 'PICKED_UP' }]) {
      await ctx.http().post(`/restaurants/${restaurantId}/orders/${id}/transition`).set(owner()).send(step).expect(200);
    }
    const token = (res.body.trackingUrl as string).split('/t/')[1];
    await ctx
      .http()
      .post(`/public/orders/${token}/rating`)
      .send({ score, ...(comment ? { comment } : {}) })
      .expect(201);
    const rating = await ctx.prisma.orderRating.findUniqueOrThrow({ where: { orderId: id } });
    return { id, token, ratingId: rating.id };
  };
  const publicPage = async () =>
    (await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/reviews`).expect(200))
      .body as PublicReviewsPageDTO;

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
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'public_reviews' } });
    await ctx.close();
  });

  it('is off by default', async () => {
    await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/reviews`).expect(404);
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/reviews`)
      .set(owner())
      .expect(403)
      .expect('x-error-code', 'FEATURE_DISABLED');
  });

  it('shows every review with a short name and masked personal data', async () => {
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/public_reviews`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    const low = await ratedOrder(
      'Ayse Yilmaz',
      2,
      'Soguktu. Beni 0532 111 22 33 arayin ya da www.ornek-site.com bakin',
    );
    await ratedOrder('Mehmet', 5);
    const page = await publicPage();
    const review = page.items.find((i) => i.id === low.ratingId)!;
    expect(review).toMatchObject({ score: 2, author: 'Ayse Y.', reply: null, editedAt: null });
    expect(review.comment).toContain('Soguktu.');
    expect(review.comment).not.toContain('0532');
    expect(review.comment).not.toContain('ornek-site');
    expect(page.items.some((i) => i.author === 'Mehmet' && i.comment === null)).toBe(true);
    expect(JSON.stringify(page)).not.toContain('05327');
    expect(page.summary?.count).toBe(ratingCountBefore + 2);

    // The restaurant reads it as written.
    const panel = (await ctx.http().get(`/restaurants/${restaurantId}/reviews`).set(owner()).expect(200))
      .body as PanelReviewsPageDTO;
    expect(panel.items.find((i) => i.id === low.ratingId)?.comment).toContain('0532');
  });

  it('lets the customer edit for a day and moves the average', async () => {
    const order = await ratedOrder('Selin Kaya', 3, 'Idare eder');
    const tracking = await ctx.http().get(`/public/orders/${order.token}`).expect(200);
    expect(tracking.body.rating.editableUntil).not.toBeNull();
    const before = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    const edited = await ctx
      .http()
      .patch(`/public/orders/${order.token}/rating`)
      .send({ score: 4, comment: 'Ikinci kez daha iyiydi' })
      .expect(200);
    expect(edited.body.rating).toMatchObject({ score: 4, comment: 'Ikinci kez daha iyiydi' });
    expect(edited.body.rating.editedAt).not.toBeNull();
    const after = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    expect(after.ratingSum - before.ratingSum).toBe(1);

    // A day later the review is fixed.
    await ctx.prisma.orderRating.update({
      where: { id: order.ratingId },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    await ctx
      .http()
      .patch(`/public/orders/${order.token}/rating`)
      .send({ comment: 'Gec degisiklik' })
      .expect(409)
      .expect('x-error-code', 'REVIEW_EDIT_CLOSED');
    const late = await ctx.http().get(`/public/orders/${order.token}`).expect(200);
    expect(late.body.rating.editableUntil).toBeNull();
  });

  it('publishes the restaurant answer, editable for a day', async () => {
    const order = await ratedOrder('Burak Demir', 4, 'Guzeldi');
    const first = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/reviews/${order.ratingId}/reply`)
      .set(owner())
      .send({ body: 'Tesekkur ederiz!' })
      .expect(200);
    expect(first.body).toMatchObject({ canReply: true, reply: { body: 'Tesekkur ederiz!', editedAt: null } });
    const second = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/reviews/${order.ratingId}/reply`)
      .set(owner())
      .send({ body: 'Tesekkur ederiz, yine bekleriz!' })
      .expect(200);
    expect(second.body.reply.editedAt).not.toBeNull();
    const shown = (await publicPage()).items.find((i) => i.id === order.ratingId)!;
    expect(shown.reply?.body).toBe('Tesekkur ederiz, yine bekleriz!');
    const tracking = await ctx.http().get(`/public/orders/${order.token}`).expect(200);
    expect(tracking.body.rating.reply.body).toBe('Tesekkur ederiz, yine bekleriz!');

    await ctx.prisma.orderRating.update({
      where: { id: order.ratingId },
      data: { replyCreatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/reviews/${order.ratingId}/reply`)
      .set(owner())
      .send({ body: 'Gec yanit' })
      .expect(409)
      .expect('x-error-code', 'REVIEW_EDIT_CLOSED');
  });

  it('takes a reported review down on the platform owner decision, and can put it back', async () => {
    const order = await ratedOrder('Kerem Ak', 1, 'Rakip isletmeye gidin');
    const before = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    const reported = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/reviews/${order.ratingId}/report`)
      .set(owner())
      .send({ reason: 'NOT_A_CUSTOMER', note: 'Siparisle ilgisi yok' })
      .expect(200);
    expect(reported.body.report).toMatchObject({ reason: 'NOT_A_CUSTOMER', resolvedAt: null });
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/reviews/${order.ratingId}/report`)
      .set(owner())
      .send({ reason: 'SPAM' })
      .expect(409)
      .expect('x-error-code', 'REVIEW_ALREADY_REPORTED');

    await ctx.http().get('/admin/reviews').set(owner()).expect(403);
    const queue = (await ctx.http().get('/admin/reviews').set(bearer(adminToken)).expect(200)).body as AdminReviewDTO[];
    expect(queue.find((r) => r.id === order.ratingId)?.restaurant.slug).toBe(SEED.restaurantSlug);

    const hidden = (
      await ctx
        .http()
        .post(`/admin/reviews/${order.ratingId}/decision`)
        .set(bearer(adminToken))
        .send({ action: 'HIDE', note: 'Kural disi' })
        .expect(200)
    ).body as AdminReviewDTO;
    expect(hidden.hiddenAt).not.toBeNull();
    expect(hidden.report?.resolvedAt).not.toBeNull();
    expect((await publicPage()).items.some((i) => i.id === order.ratingId)).toBe(false);
    const afterHide = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    expect(afterHide.ratingCount).toBe(before.ratingCount - 1);
    expect(afterHide.ratingSum).toBe(before.ratingSum - 1);
    const hiddenList = (await ctx.http().get('/admin/reviews?status=HIDDEN').set(bearer(adminToken)).expect(200))
      .body as AdminReviewDTO[];
    expect(hiddenList.some((r) => r.id === order.ratingId)).toBe(true);

    await ctx
      .http()
      .post(`/admin/reviews/${order.ratingId}/decision`)
      .set(bearer(adminToken))
      .send({ action: 'RESTORE' })
      .expect(200);
    expect((await publicPage()).items.some((i) => i.id === order.ratingId)).toBe(true);
    const afterRestore = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    expect(afterRestore.ratingCount).toBe(before.ratingCount);
    // Nothing left to decide on a restored, resolved report.
    await ctx
      .http()
      .post(`/admin/reviews/${order.ratingId}/decision`)
      .set(bearer(adminToken))
      .send({ action: 'DISMISS' })
      .expect(409);
  });

  it('closes a report without taking the review down', async () => {
    const order = await ratedOrder('Elif Su', 2, 'Beklentimi karsilamadi');
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/reviews/${order.ratingId}/report`)
      .set(owner())
      .send({ reason: 'OTHER' })
      .expect(200);
    const dismissed = (
      await ctx
        .http()
        .post(`/admin/reviews/${order.ratingId}/decision`)
        .set(bearer(adminToken))
        .send({ action: 'DISMISS' })
        .expect(200)
    ).body as AdminReviewDTO;
    expect(dismissed).toMatchObject({ hiddenAt: null });
    expect(dismissed.report?.resolvedAt).not.toBeNull();
    expect((await publicPage()).items.some((i) => i.id === order.ratingId)).toBe(true);
  });
});
