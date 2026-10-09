import { normalizePhone } from '@resget/shared';
import type { JourneyDTO, JourneyListDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { JourneysService } from '../../src/modules/journeys/journeys.service';
import { ConsentService } from '../../src/modules/consent/consent.service';
import { MockSmsProvider } from '../../src/modules/messaging/sms.provider';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const PHONES = ['05329990981', '05329990982', '05329990983', '05329990984', '05329990985'].map((p) =>
  normalizePhone(p)!,
);

/** A fixed-offset zone where it is now around noon: inside the send window and the demo branch's opening hours. */
function noonZone(now: Date): string {
  const offset = 12 - now.getUTCHours();
  if (offset === 0) return 'Etc/UTC';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/** Automated flows (docs/AKISLAR.md): switch, enrolment on completion, sending, exits, win-back, credit. */
describe('Journeys (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let restaurantName: string;
  let menuItemId: string;
  let originalTimezone: string;
  let walletId: string;
  let walletOriginal: number;
  let journeys: JourneysService;
  let sms: jest.SpyInstance;
  const flows: Record<string, JourneyDTO> = {};
  const orderIds: string[] = [];
  const base = () => `/restaurants/${restaurantId}/journeys`;
  const auth = () => bearer(ownerToken, restaurantId);
  const feature = (key: string, enabled: boolean) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/${key}`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const transition = (id: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${id}/transition`)
      .set(auth())
      .send({ to, ...extra })
      .expect(200);
  const placeOrder = async (phone: string, fullName: string) => {
    const res = await ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity: 1 }],
        customer: { fullName, phone },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(201);
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { trackingToken: (res.body as { trackingToken: string }).trackingToken },
      select: { id: true, trackingToken: true },
    });
    orderIds.push(order.id);
    return order;
  };
  const completeOrder = async (phone: string, fullName: string) => {
    const order = await placeOrder(phone, fullName);
    await transition(order.id, 'ACCEPTED', { prepMinutes: 5 });
    await transition(order.id, 'READY');
    await transition(order.id, 'PICKED_UP');
    return order;
  };
  const customerOf = async (phone: string) =>
    ctx.prisma.restaurantCustomer.findFirstOrThrow({ where: { restaurantId, user: { phone } }, select: { id: true } });
  const grantSms = async (phone: string) =>
    ctx.app
      .get(ConsentService)
      .grant({
        restaurantId,
        customerId: (await customerOf(phone)).id,
        channels: ['SMS'],
        source: 'SITE_FORM',
        phoneVerified: true,
      });
  const runsOf = (journeyId: string) =>
    ctx.prisma.journeyRun.findMany({ where: { journeyId }, orderBy: { createdAt: 'asc' } });
  const create = async (body: Record<string, unknown>) => {
    const journey = (await ctx.http().post(base()).set(auth()).send(body).expect(201)).body as JourneyDTO;
    expect(journey.status).toBe('PAUSED');
    await ctx.http().patch(`${base()}/${journey.id}`).set(auth()).send({ status: 'ACTIVE' }).expect(200);
    return journey;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    journeys = ctx.app.get(JourneysService);
    sms = jest.spyOn(ctx.app.get(MockSmsProvider), 'send');
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, name: true, timezone: true },
    });
    restaurantId = restaurant.id;
    restaurantName = restaurant.name;
    originalTimezone = restaurant.timezone;
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { timezone: noonZone(new Date()) } });
    menuItemId = (
      await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, isAvailable: true }, select: { id: true } })
    ).id;
    const wallet = await ctx.prisma.messageWallet.findUniqueOrThrow({
      where: { restaurantId_channel: { restaurantId, channel: 'SMS' } },
    });
    walletId = wallet.id;
    walletOriginal = wallet.balance;
    await ctx.prisma.messageWallet.update({ where: { id: walletId }, data: { balance: 100 } });
    await ctx.prisma.journey.deleteMany({ where: { restaurantId } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  });

  afterAll(async () => {
    sms.mockRestore();
    await ctx.prisma.journey.deleteMany({ where: { restaurantId } });
    await ctx.prisma.segment.deleteMany({ where: { restaurantId, name: 'Akis segment' } });
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { restaurantId, user: { phone: { in: PHONES } } } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: { in: ['journeys', 'segments_v2'] } } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { timezone: originalTimezone } });
    await ctx.prisma.messageWallet.update({ where: { id: walletId }, data: { balance: walletOriginal } });
    await ctx.close();
  });

  it('is behind its switch, starts flows paused and checks the text', async () => {
    await ctx.http().get(base()).set(auth()).expect(403).expect('x-error-code', 'FEATURE_DISABLED');
    await feature('journeys', true);
    await ctx
      .http()
      .post(base())
      .set(auth())
      .send({ name: 'Geri kazan', trigger: 'WIN_BACK', channel: 'SMS', body: 'Sizi ozledik {link}' })
      .expect(400);
    await ctx
      .http()
      .post(base())
      .set(auth())
      .send({ name: 'Uzun', trigger: 'ORDER_COMPLETED', channel: 'SMS', body: 'x'.repeat(301) })
      .expect(400);
    flows.thanks = await create({
      name: 'Tesekkur',
      trigger: 'ORDER_COMPLETED',
      channel: 'SMS',
      body: 'Merhaba {name}, siparisiniz icin tesekkurler.',
      delayHours: 0,
    });
    flows.first = await create({
      name: 'Ilk siparis',
      trigger: 'FIRST_ORDER',
      channel: 'SMS',
      body: 'Merhaba {name}, {restaurant} ailesine hos geldiniz.',
      delayHours: 0,
    });
    flows.review = await create({
      name: 'Degerlendirme',
      trigger: 'REVIEW_REQUEST',
      channel: 'SMS',
      body: 'Siparisiniz nasildi? {link}',
      delayHours: 1,
    });
    const list = (await ctx.http().get(base()).set(auth()).expect(200)).body as JourneyListDTO;
    expect(list.items.filter((j) => j.status === 'ACTIVE')).toHaveLength(3);
    expect(list.items.find((j) => j.id === flows.thanks.id)?.cooldownDays).toBe(30);
  });

  it('enrols a customer when an order completes and sends each message when it is due', async () => {
    const first = await placeOrder(PHONES[0], 'Akis Bir');
    await grantSms(PHONES[0]);
    await transition(first.id, 'ACCEPTED', { prepMinutes: 5 });
    await transition(first.id, 'READY');
    await transition(first.id, 'PICKED_UP');
    for (const flow of [flows.thanks, flows.first, flows.review]) {
      const runs = await runsOf(flow.id);
      expect(runs).toHaveLength(1);
      expect(runs[0].orderId).toBe(first.id);
    }

    sms.mockClear();
    const start = new Date();
    await journeys.runPass(start);
    expect((await runsOf(flows.thanks.id))[0].status).toBe('SENT');
    expect((await runsOf(flows.first.id))[0].status).toBe('SENT');
    expect((await runsOf(flows.review.id))[0].status).toBe('PENDING');
    const texts = sms.mock.calls.map((call) => String(call[1]));
    expect(texts.some((text) => text.includes('Merhaba Akis, siparisiniz icin tesekkurler.'))).toBe(true);
    expect(texts.some((text) => text.includes(`${restaurantName} ailesine hos geldiniz`))).toBe(true);

    sms.mockClear();
    await journeys.runPass(new Date(start.getTime() + HOUR_MS));
    expect((await runsOf(flows.review.id))[0].status).toBe('SENT');
    expect(sms.mock.calls.some((call) => String(call[1]).includes(`/t/${first.trackingToken}`))).toBe(true);

    // The second order: no first-order message, the cooldown holds the others back.
    await completeOrder(PHONES[0], 'Akis Bir');
    expect(await runsOf(flows.thanks.id)).toHaveLength(1);
    expect(await runsOf(flows.first.id)).toHaveLength(1);
    expect(await runsOf(flows.review.id)).toHaveLength(1);
  });

  it('cancels a waiting message whose reason is gone and skips a customer without consent', async () => {
    await ctx
      .http()
      .patch(`${base()}/${flows.thanks.id}`)
      .set(auth())
      .send({ cooldownDays: 0, delayHours: 2 })
      .expect(200);
    const refunded = await completeOrder(PHONES[0], 'Akis Bir');
    await ctx.prisma.order.update({ where: { id: refunded.id }, data: { status: 'REFUNDED' } });

    // Another customer rates the order before the review request is due.
    const rated = await placeOrder(PHONES[1], 'Akis Iki');
    await grantSms(PHONES[1]);
    await transition(rated.id, 'ACCEPTED', { prepMinutes: 5 });
    await transition(rated.id, 'READY');
    await transition(rated.id, 'PICKED_UP');
    await ctx.prisma.orderRating.create({ data: { orderId: rated.id, restaurantId, score: 5 } });

    // A third customer never consented.
    await completeOrder(PHONES[2], 'Akis Uc');

    await journeys.runPass(new Date(Date.now() + 2 * HOUR_MS));
    const thanks = await runsOf(flows.thanks.id);
    expect(thanks.find((r) => r.orderId === refunded.id)).toMatchObject({
      status: 'CANCELLED',
      errorCode: 'ORDER_CANCELLED',
    });
    expect(thanks.find((r) => r.orderId === rated.id)?.status).toBe('SENT');
    const review = await runsOf(flows.review.id);
    expect(review.find((r) => r.orderId === rated.id)).toMatchObject({
      status: 'CANCELLED',
      errorCode: 'ALREADY_RATED',
    });
    const unconsented = await customerOf(PHONES[2]);
    for (const run of [...thanks, ...review].filter((r) => r.customerId === unconsented.id)) {
      expect(run.status).toBe('SKIPPED');
      expect(run.errorCode).toBe('NO_CONSENT');
    }
  });

  it('wins back customers whose last order is inside the window and drops those who came back', async () => {
    const now = new Date();
    // Two lapsed customers (40 days) and one lost long ago (100 days).
    for (const [i, phone] of [PHONES[3], PHONES[4]].entries()) {
      await placeOrder(phone, `Akis Kayip ${i + 1}`);
      await grantSms(phone);
    }
    await ctx.prisma.restaurantCustomer.updateMany({
      where: { restaurantId, user: { phone: { in: [PHONES[3], PHONES[4]] } } },
      data: { lastOrderAt: new Date(now.getTime() - 40 * DAY_MS) },
    });
    await ctx.prisma.restaurantCustomer.updateMany({
      where: { restaurantId, user: { phone: PHONES[2] } },
      data: { lastOrderAt: new Date(now.getTime() - 100 * DAY_MS) },
    });
    flows.winBack = await create({
      name: 'Geri kazanim',
      trigger: 'WIN_BACK',
      channel: 'SMS',
      body: 'Merhaba {name}, sizi ozledik.',
      inactiveDays: 30,
      delayHours: 1,
    });
    await journeys.runPass(now);
    const enrolled = await runsOf(flows.winBack.id);
    const lapsed = await Promise.all([customerOf(PHONES[3]), customerOf(PHONES[4])]);
    const lost = await customerOf(PHONES[2]);
    const ids = enrolled.map((r) => r.customerId);
    expect(ids).toEqual(expect.arrayContaining(lapsed.map((c) => c.id)));
    expect(ids).not.toContain(lost.id);

    // One of them orders again before the message is due.
    await ctx.prisma.restaurantCustomer.update({ where: { id: lapsed[1].id }, data: { lastOrderAt: new Date() } });
    await journeys.runPass(new Date(now.getTime() + HOUR_MS));
    const after = await runsOf(flows.winBack.id);
    expect(after.find((r) => r.customerId === lapsed[0].id)?.status).toBe('SENT');
    expect(after.find((r) => r.customerId === lapsed[1].id)).toMatchObject({
      status: 'CANCELLED',
      errorCode: 'ORDERED_AGAIN',
    });
    // A later scan does not take the same customers in again.
    await journeys.runPass(new Date(now.getTime() + 3 * HOUR_MS));
    expect(await runsOf(flows.winBack.id)).toHaveLength(enrolled.length);
  });

  it('credits the next order to the latest flow message and guards a segment a flow uses', async () => {
    const lapsed = await customerOf(PHONES[3]);
    const run = (await runsOf(flows.winBack.id)).find((r) => r.customerId === lapsed.id)!;
    // The runner was driven with a later clock; the message went out a minute ago on the real one.
    await ctx.prisma.journeyRun.update({ where: { id: run.id }, data: { sentAt: new Date(Date.now() - 60_000) } });
    const order = await placeOrder(PHONES[3], 'Akis Kayip 1');
    const credited = await ctx.prisma.journeyRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(credited.convertedOrderId).toBe(order.id);
    const list = (await ctx.http().get(base()).set(auth()).expect(200)).body as JourneyListDTO;
    const stats = list.items.find((j) => j.id === flows.winBack.id)!.stats;
    expect(stats.conversions).toBe(1);
    expect(stats.revenueMinor).toBe(credited.revenueMinor);

    await feature('segments_v2', true);
    const segment = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/segments`)
        .set(auth())
        .send({ name: 'Akis segment', kind: 'DYNAMIC', rule: { op: 'AND', rules: [] } })
        .expect(201)
    ).body as { id: string };
    await ctx.http().patch(`${base()}/${flows.thanks.id}`).set(auth()).send({ segmentId: segment.id }).expect(200);
    await ctx
      .http()
      .delete(`/restaurants/${restaurantId}/segments/${segment.id}`)
      .set(auth())
      .expect(409)
      .expect('x-error-code', 'SEGMENT_IN_USE');
    await ctx.http().delete(`${base()}/${flows.thanks.id}`).set(auth()).expect(204);
    await ctx.http().delete(`/restaurants/${restaurantId}/segments/${segment.id}`).set(auth()).expect(204);
  });
});
