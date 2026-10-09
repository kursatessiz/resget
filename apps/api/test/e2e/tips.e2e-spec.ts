import { createHmac } from 'node:crypto';
import type { PaymentMode } from '@resget/database';
import { normalizePhone } from '@resget/shared';
import type {
  CourierTipsSummaryDTO,
  OrderDetailDTO,
  OrderTrackingDTO,
  TipDTO,
  TipStartedDTO,
  TipsReportDTO,
} from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const COURIER_PHONE = normalizePhone('05320000004')!;
const NOTE = 'e2e-tips';
const MERCHANT = 'merchant-tips';
const RETURN_URL = 'https://app.example.com/t/back';

/** Courier tips after delivery: own courier, platform collection and a courier network (docs/BAHSIS.md). */
describe('Courier tips (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let itemId: string;
  let currency: string;
  let connectionId: string;
  let courierMembershipId: string;
  let original: PaymentMode;
  const tripIds: string[] = [];
  const owner = () => bearer(ownerToken);

  const signed = (secret: string, payload: Record<string, unknown>) => {
    const body = JSON.stringify({ currency, pspFeeMinor: 0, occurredAt: new Date().toISOString(), ...payload });
    return { body, signature: createHmac('sha256', secret).update(body).digest('hex') };
  };
  const notify = (path: string, secret: string, payload: Record<string, unknown>, status = 200) => {
    const { body, signature } = signed(secret, payload);
    return ctx
      .http()
      .post(path)
      .set('content-type', 'application/json')
      .set('x-mock-signature', signature)
      .send(body)
      .expect(status);
  };
  const posNotice = (payload: Record<string, unknown>) =>
    notify(`/webhooks/payments/pos/${connectionId}`, MERCHANT, payload);
  // The platform's MOCK merchant has no credentials; its signature secret falls back to "mock".
  const platformNotice = (payload: Record<string, unknown>, status = 200) =>
    notify('/webhooks/payments/platform/MOCK', 'mock', payload, status);
  const tracking = async (token: string) =>
    (await ctx.http().get(`/public/orders/${token}`).expect(200)).body as OrderTrackingDTO;
  const startTip = (token: string, amountMinor: number, status = 200) =>
    ctx.http().post(`/public/orders/${token}/tip`).send({ amountMinor, returnUrl: RETURN_URL }).expect(status);

  /** A delivery order placed through the API, then marked delivered by the given courier or network. */
  const deliveredOrder = async (name: string, by: 'OWN' | { providerRef: string }) => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'DELIVERY',
        items: [{ menuItemId: itemId, quantity: 2 }],
        address: {
          addressLine: `${name} Sok. No 5`,
          city: 'Istanbul',
          district: 'Kadikoy',
          contactName: name,
          contactPhone: '0532 999 05 05',
          point: { lat: 40.99, lng: 29.03 },
        },
        customer: { fullName: name, phone: '0532 999 05 05' },
        deliveryFeeMinor: 1500,
        note: NOTE,
      })
      .expect(201);
    const order = res.body as OrderDetailDTO & { trackingUrl: string };
    const now = new Date();
    await ctx.prisma.order.update({ where: { id: order.id }, data: { status: 'DELIVERED', completedAt: now } });
    if (by === 'OWN') {
      const trip = await ctx.prisma.deliveryTrip.create({
        data: { restaurantId, branchId, courierMembershipId, status: 'COMPLETED', completedAt: now },
      });
      tripIds.push(trip.id);
      await ctx.prisma.deliveryStop.create({
        data: { tripId: trip.id, restaurantId, orderId: order.id, sequence: 1, status: 'DELIVERED', deliveredAt: now },
      });
    } else {
      const provider = await ctx.prisma.courierProvider.findUniqueOrThrow({ where: { code: 'MOCK' } });
      await ctx.prisma.deliveryRequest.create({
        data: {
          restaurantId,
          orderId: order.id,
          providerId: provider.id,
          status: 'DELIVERED',
          quoteFeeMinor: 4000,
          currency,
          providerRef: by.providerRef,
        },
      });
    }
    return { id: order.id, token: order.trackingUrl.split('/t/')[1], total: order.chargedToCustomerMinor };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true, menuItems: true },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    currency = restaurant.currency;
    original = restaurant.paymentMode;
    itemId = restaurant.menuItems.find((m) => m.name === 'Izgara kofte')!.id;
    courierMembershipId = (
      await ctx.prisma.membership.findFirstOrThrow({ where: { restaurantId, user: { phone: COURIER_PHONE } } })
    ).id;
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.paymentProviderConnection.deleteMany({ where: { restaurantId } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/connection`)
      .set(owner())
      .send({ providerCode: 'MOCK', credentials: { merchantId: MERCHANT } })
      .expect(200);
    connectionId = (await ctx.prisma.paymentProviderConnection.findUniqueOrThrow({ where: { restaurantId } })).id;
  });

  afterAll(async () => {
    const orders = await ctx.prisma.order.findMany({
      where: { restaurantId, customerNote: NOTE },
      select: { id: true },
    });
    await ctx.prisma.ledgerEntry.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.deliveryTrip.deleteMany({ where: { id: { in: tripIds } } });
    await ctx.prisma.paymentProviderConnection.deleteMany({ where: { restaurantId } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'courier_tips' } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: original } });
    await ctx.close();
  });

  it('is off by default', async () => {
    const order = await deliveredOrder('Bahsis Kapali', 'OWN');
    expect((await tracking(order.token)).tipOffer).toBeNull();
    expect((await startTip(order.token, 2000, 409)).headers['x-error-code']).toBe('TIP_UNAVAILABLE');
    const off = await ctx.http().get(`/restaurants/${restaurantId}/tips`).set(owner()).expect(403);
    expect(off.headers['x-error-code']).toBe('FEATURE_DISABLED');
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/courier_tips`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
  });

  it("tips the restaurant's own courier through its POS, outside the order's money", async () => {
    const order = await deliveredOrder('Bahsis Kendi', 'OWN');
    const before = (await ctx.http().get(`/restaurants/${restaurantId}/orders/${order.id}`).set(owner()).expect(200))
      .body as OrderDetailDTO;
    const offer = (await tracking(order.token)).tipOffer!;
    expect(offer).toMatchObject({ currency, maxMinor: order.total, recipient: 'Demo' });
    expect(offer.presetsMinor).toEqual([500, 1000, 1500].map((bps) => Math.round((order.total * bps) / 10000)));
    expect((await startTip(order.token, order.total + 1, 400)).headers['x-error-code']).toBe('TIP_AMOUNT_INVALID');
    expect((await startTip(order.token, 1, 400)).headers['x-error-code']).toBe('TIP_AMOUNT_INVALID');

    const started = (await startTip(order.token, 2500)).body as TipStartedDTO;
    expect(started.session.redirectUrl).toContain(RETURN_URL);
    expect((await tracking(order.token)).tip).toMatchObject({ status: 'PENDING', amountMinor: 2500 });
    await posNotice({
      providerRef: 'tip-own-1',
      orderRef: started.tipId,
      status: 'CAPTURED',
      amountMinor: 2500,
      pspFeeMinor: 90,
    });
    // A repeated notice changes nothing.
    await posNotice({
      providerRef: 'tip-own-1',
      orderRef: started.tipId,
      status: 'CAPTURED',
      amountMinor: 2500,
      pspFeeMinor: 90,
    });

    const after = await tracking(order.token);
    expect(after.tip).toMatchObject({ status: 'CAPTURED', amountMinor: 2500 });
    expect(after.tipOffer).toBeNull();
    expect((await startTip(order.token, 2000, 409)).headers['x-error-code']).toBe('TIP_ALREADY_PAID');
    const tip = await ctx.prisma.courierTip.findUniqueOrThrow({ where: { id: started.tipId } });
    expect(tip).toMatchObject({ paymentMode: 'OWN_POS', pspFeeMinor: 90, courierMembershipId });
    // The restaurant collected it on its own POS: no ledger line, and the order still owes what it owed.
    expect(await ctx.prisma.ledgerEntry.count({ where: { orderId: order.id } })).toBe(0);
    const detail = (await ctx.http().get(`/restaurants/${restaurantId}/orders/${order.id}`).set(owner()).expect(200))
      .body as OrderDetailDTO;
    expect(detail.payment).toEqual(before.payment);

    // The courier sees the tip in their own summary; the owner, who delivered nothing, does not.
    const courierToken = await ctx.login(COURIER_PHONE);
    const mine = (
      await ctx.http().get(`/restaurants/${restaurantId}/tips/me`).set(bearer(courierToken, restaurantId)).expect(200)
    ).body as CourierTipsSummaryDTO;
    expect(mine.recent.find((r) => r.id === started.tipId)).toMatchObject({ status: 'CAPTURED', netMinor: 2410 });
    expect(mine.totals.netMinor).toBeGreaterThanOrEqual(2410);
    const theirs = (await ctx.http().get(`/restaurants/${restaurantId}/tips/me`).set(owner()).expect(200))
      .body as CourierTipsSummaryDTO;
    expect(theirs.recent.some((r) => r.id === started.tipId)).toBe(false);
  });

  it('offers no tip for an order without a courier', async () => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 1 }],
        note: NOTE,
      })
      .expect(201);
    await ctx.prisma.order.update({
      where: { id: res.body.id },
      data: { status: 'PICKED_UP', completedAt: new Date() },
    });
    const token = (res.body.trackingUrl as string).split('/t/')[1];
    expect((await tracking(token)).tipOffer).toBeNull();
    await startTip(token, 1000, 409);
  });

  it('collects on the platform merchant, books the tip for the payout and takes a chargeback back', async () => {
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'PLATFORM_PSP' } });
    const order = await deliveredOrder('Bahsis Platform', 'OWN');
    const started = (await startTip(order.token, 3000)).body as TipStartedDTO;
    // The restaurant's POS did not collect this tip, and an unconfigured provider is no platform merchant.
    const wrong = await posNotice({
      providerRef: 'tip-p-1',
      orderRef: started.tipId,
      status: 'CAPTURED',
      amountMinor: 3000,
    });
    expect(wrong.body.status).toBe('IGNORED');
    await notify('/webhooks/payments/platform/PAYTR', 'mock', { orderRef: started.tipId, status: 'CAPTURED' }, 400);
    await platformNotice({
      providerRef: 'tip-p-1',
      orderRef: started.tipId,
      status: 'CAPTURED',
      amountMinor: 3000,
      pspFeeMinor: 120,
    });
    const lines = await ctx.prisma.ledgerEntry.findMany({ where: { orderId: order.id }, orderBy: { type: 'asc' } });
    expect(lines.map((l) => [l.type, l.amountMinor])).toEqual([
      ['COURIER_TIP', 3000],
      ['COURIER_TIP_FEE', -120],
    ]);

    await platformNotice({ providerRef: 'tip-p-1', orderRef: started.tipId, status: 'CHARGEBACK', amountMinor: 3000 });
    await platformNotice({ providerRef: 'tip-p-1', orderRef: started.tipId, status: 'CHARGEBACK', amountMinor: 3000 });
    expect((await tracking(order.token)).tip?.status).toBe('CHARGED_BACK');
    const reversal = await ctx.prisma.ledgerEntry.findMany({
      where: { orderId: order.id, type: 'COURIER_TIP', amountMinor: { lt: 0 } },
    });
    expect(reversal.map((l) => l.amountMinor)).toEqual([-3000]);
  });

  it('confirms a platform-collected order payment on the platform webhook', async () => {
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 1 }],
        customer: { fullName: 'Platform Odeme', phone: '0532 999 05 06' },
        payment: { method: 'ONLINE_CARD' },
        note: NOTE,
      })
      .expect(201);
    const order = created.body as OrderDetailDTO;
    expect(order.status).toBe('PENDING_PAYMENT');
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${order.id}/checkout`)
      .set(owner())
      .send({ returnUrl: RETURN_URL })
      .expect(200);
    await platformNotice({
      providerRef: 'order-p-1',
      orderRef: order.id,
      status: 'CAPTURED',
      amountMinor: order.chargedToCustomerMinor,
    });
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PLACED');
  });

  it('hands a tip to a courier network and retries a failed hand-over', async () => {
    const order = await deliveredOrder('Bahsis Ag', { providerRef: 'mock-tip-fail-1' });
    expect((await tracking(order.token)).tipOffer?.recipient).toBe('Mock courier network');
    const started = (await startTip(order.token, 2000)).body as TipStartedDTO;
    await platformNotice({
      providerRef: 'tip-n-1',
      orderRef: started.tipId,
      status: 'CAPTURED',
      amountMinor: 2000,
      pspFeeMinor: 80,
    });
    expect(await ctx.prisma.courierTip.findUniqueOrThrow({ where: { id: started.tipId } })).toMatchObject({
      status: 'CAPTURED',
      passThroughStatus: 'FAILED',
      passThroughAttempts: 1,
    });

    let report = (await ctx.http().get(`/restaurants/${restaurantId}/tips`).set(owner()).expect(200))
      .body as TipsReportDTO;
    expect(report.networks).toEqual([
      expect.objectContaining({
        providerCode: 'MOCK',
        count: 1,
        grossMinor: 2000,
        feeMinor: 80,
        netMinor: 1920,
        failedPassThrough: 1,
      }),
    ]);
    expect(report.couriers).toEqual([
      expect.objectContaining({ membershipId: courierMembershipId, count: 1, grossMinor: 2500, netMinor: 2410 }),
    ]);
    expect(report.totals).toMatchObject({ count: 2, grossMinor: 4500 });

    await ctx.prisma.deliveryRequest.update({ where: { orderId: order.id }, data: { providerRef: 'mock-ok-1' } });
    const retried = (
      await ctx.http().post(`/restaurants/${restaurantId}/tips/${started.tipId}/pass-through`).set(owner()).expect(200)
    ).body as TipDTO;
    expect(retried).toMatchObject({ passThroughStatus: 'SENT', netMinor: 1920, recipient: 'Mock courier network' });
    const again = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/tips/${started.tipId}/pass-through`)
      .set(owner())
      .expect(409);
    expect(again.headers['x-error-code']).toBe('TIP_UNAVAILABLE');
    report = (await ctx.http().get(`/restaurants/${restaurantId}/tips?days=7`).set(owner()).expect(200))
      .body as TipsReportDTO;
    expect(report.networks[0].failedPassThrough).toBe(0);
  });

  it('refunds a collected tip from the panel once, through the account that took it', async () => {
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'PLATFORM_PSP' } });
    const refundTip = (tipId: string, body: Record<string, unknown>, auth = owner()) =>
      ctx.http().post(`/restaurants/${restaurantId}/tips/${tipId}/refund`).set(auth).send(body);

    // A provider that refuses: the tip stays collected and the reason comes back.
    const declined = await deliveredOrder('Bahsis Iade Ret', 'OWN');
    const declinedTip = (await startTip(declined.token, 2000)).body as TipStartedDTO;
    await platformNotice({
      providerRef: 'refund-decline-tip',
      orderRef: declinedTip.tipId,
      status: 'CAPTURED',
      amountMinor: 2000,
    });
    const refused = await refundTip(declinedTip.tipId, { reason: 'wrong amount' }).expect(409);
    expect(refused.body.code).toBe('TIP_REFUND_DECLINED');
    expect((await ctx.prisma.courierTip.findUniqueOrThrow({ where: { id: declinedTip.tipId } })).status).toBe(
      'CAPTURED',
    );

    const order = await deliveredOrder('Bahsis Iade', 'OWN');
    const started = (await startTip(order.token, 2500)).body as TipStartedDTO;
    await platformNotice({
      providerRef: 'tip-r-1',
      orderRef: started.tipId,
      status: 'CAPTURED',
      amountMinor: 2500,
      pspFeeMinor: 100,
    });
    // A courier cannot give money back, and a reason is required.
    await refundTip(started.tipId, { reason: 'x' }, bearer(await ctx.login(COURIER_PHONE))).expect(403);
    await refundTip(started.tipId, { reason: ' ' }).expect(400);

    const refunded = (await refundTip(started.tipId, { reason: 'customer asked' }).expect(200)).body as TipDTO;
    expect(refunded).toMatchObject({ status: 'REFUNDED', refundReason: 'customer asked' });
    expect((await tracking(order.token)).tip?.status).toBe('REFUNDED');
    const again = await refundTip(started.tipId, { reason: 'twice' }).expect(409);
    expect(again.body.code).toBe('TIP_REFUND_NOT_ALLOWED');
    // The provider's own notice afterwards changes nothing; one reversal line, the fee stays with the provider.
    await platformNotice({ providerRef: 'tip-r-1', orderRef: started.tipId, status: 'REFUNDED', amountMinor: 2500 });
    const lines = await ctx.prisma.ledgerEntry.findMany({
      where: { orderId: order.id },
      orderBy: [{ occurredAt: 'asc' }, { amountMinor: 'desc' }],
    });
    expect(lines.map((l) => [l.type, l.amountMinor])).toEqual([
      ['COURIER_TIP', 2500],
      ['COURIER_TIP_FEE', -100],
      ['COURIER_TIP', -2500],
    ]);
    const row = await ctx.prisma.courierTip.findUniqueOrThrow({ where: { id: started.tipId } });
    expect(row.refundRequestedAt).toBeNull();
    expect(row.refundedByUserId).not.toBeNull();
    expect(await ctx.prisma.auditLog.count({ where: { action: 'tip.refunded', entityId: started.tipId } })).toBe(1);
  });
});
