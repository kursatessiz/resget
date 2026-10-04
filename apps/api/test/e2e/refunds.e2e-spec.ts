import { createHmac } from 'node:crypto';
import { PaymentMode } from '@resget/database';
import { normalizePhone } from '@resget/shared';
import { RefundsService } from '../../src/modules/payments/refunds.service';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const COURIER_PHONE = normalizePhone('05320000004')!;
const NOTE = 'e2e-refund';
const MERCHANT = 'merchant-refund';

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Refunds through the capturing gateway, the automatic path after a cancellation and the ledger (docs/ODEME.md). */
describe('Refunds (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let courierToken: string;
  let restaurantId: string;
  let branchId: string;
  let menuItemId: string;
  let connectionId: string;
  let originalMode: PaymentMode;

  const createOrder = async (payment: Record<string, unknown>) => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken))
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity: 1 }],
        customer: { fullName: 'Iade Musteri', phone: '0532 999 07 41' },
        note: NOTE,
        payment,
      })
      .expect(201);
    return res.body as { id: string; status: string; chargedToCustomerMinor: number };
  };
  const getOrder = async (orderId: string) =>
    (await ctx.http().get(`/restaurants/${restaurantId}/orders/${orderId}`).set(bearer(ownerToken)).expect(200)).body;
  const transition = (orderId: string, to: string, extra: Record<string, unknown> = {}, expected = 200) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${orderId}/transition`)
      .set(bearer(ownerToken))
      .send({ to, ...extra })
      .expect(expected);
  const refund = (orderId: string, body: Record<string, unknown>, expected: number, token = ownerToken) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${orderId}/refund`)
      .set(bearer(token))
      .send(body)
      .expect(expected);
  const posWebhook = (payload: Record<string, unknown>) => {
    const body = JSON.stringify({ currency: 'TRY', pspFeeMinor: 0, occurredAt: new Date().toISOString(), ...payload });
    return ctx
      .http()
      .post(`/webhooks/payments/pos/${connectionId}`)
      .set('content-type', 'application/json')
      .set('x-mock-signature', sign(MERCHANT, body))
      .send(body)
      .expect(200);
  };
  /** An online card order captured on the restaurant's own POS with the given provider reference. */
  const paidOrder = async (providerRef: string) => {
    const order = await createOrder({ method: 'ONLINE_CARD' });
    expect(order.status).toBe('PENDING_PAYMENT');
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${order.id}/checkout`)
      .set(bearer(ownerToken))
      .send({ returnUrl: 'https://app.example.com/odeme' })
      .expect(200);
    await posWebhook({
      providerRef,
      orderRef: order.id,
      status: 'CAPTURED',
      amountMinor: order.chargedToCustomerMinor,
    });
    expect((await getOrder(order.id)).status).toBe('PLACED');
    return order;
  };
  const complete = async (orderId: string) => {
    await transition(orderId, 'ACCEPTED', { prepMinutes: 5 });
    await transition(orderId, 'READY');
    await transition(orderId, 'PICKED_UP');
  };
  const smsCount = (templateKey: string) =>
    ctx.prisma.messageLog.count({ where: { restaurantId, channel: { in: ['SMS', 'WHATSAPP'] }, templateKey } });
  const cleanup = async () => {
    const orders = await ctx.prisma.order.findMany({
      where: { restaurantId, customerNote: NOTE },
      select: { id: true },
    });
    await ctx.prisma.ledgerEntry.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    await ctx.prisma.auditLog.deleteMany({ where: { restaurantId, action: 'payment.charged_back' } });
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [ownerToken, courierToken] = await Promise.all([ctx.login(SEED.ownerPhone), ctx.login(COURIER_PHONE)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, paymentMode: true, branches: { take: 1, select: { id: true } } },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    originalMode = restaurant.paymentMode;
    menuItemId = (
      await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, isAvailable: true }, select: { id: true } })
    ).id;
    await cleanup();
    await ctx.prisma.paymentProviderConnection.deleteMany({ where: { restaurantId } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/connection`)
      .set(bearer(ownerToken))
      .send({ providerCode: 'MOCK', credentials: { merchantId: MERCHANT } })
      .expect(200);
    connectionId = (await ctx.prisma.paymentProviderConnection.findUniqueOrThrow({ where: { restaurantId } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await ctx.prisma.paymentProviderConnection.deleteMany({ where: { restaurantId } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: originalMode } });
    await ctx.close();
  });

  it('refunds a rejected online order through the POS right away and says so in one message', async () => {
    const order = await paidOrder('pos-refund-1');
    const rejectedBefore = await smsCount('order.rejected');
    const refundedBefore = await smsCount('order.refunded');
    const res = await transition(order.id, 'REJECTED', { reason: 'Malzeme bitti' });
    expect(res.body.status).toBe('REFUNDED');
    expect(res.body.payment).toMatchObject({
      refundState: 'DONE',
      refundedMinor: order.chargedToCustomerMinor,
      dueMinor: 0,
      refundable: false,
      refundFailureCode: null,
    });
    const history = res.body.history.map((h: { to: string }) => h.to);
    expect(history.slice(-2)).toEqual(['REJECTED', 'REFUNDED']);
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment.status).toBe('REFUNDED');
    expect(payment.refundProviderRef).toMatch(/^mock-refund-/);
    expect(payment.refundAttempts).toBe(1);
    // OWN_POS money never enters the ledger.
    expect(await ctx.prisma.ledgerEntry.count({ where: { orderId: order.id } })).toBe(0);
    expect(await smsCount('order.rejected')).toBe(rejectedBefore + 1);
    expect(await smsCount('order.refunded')).toBe(refundedBefore);
  });

  it('keeps a declined or failed refund visible, lets staff retry and retries it with back-off', async () => {
    const declined = await paidOrder('refund-decline-1');
    await transition(declined.id, 'ACCEPTED', { prepMinutes: 5 });
    const cancelled = await transition(declined.id, 'CANCELLED_BY_RESTAURANT', { reason: 'Kurye yok' });
    expect(cancelled.body.status).toBe('CANCELLED_BY_RESTAURANT');
    expect(cancelled.body.payment).toMatchObject({
      refundState: 'FAILED',
      refundFailureCode: 'REFUND_DECLINED',
      refundable: true,
      dueMinor: 0,
    });
    const retry = await refund(declined.id, { reason: 'Tekrar dene' }, 409);
    expect(retry.body.code).toBe('REFUND_DECLINED');

    const errored = await paidOrder('refund-error-1');
    const rejected = await transition(errored.id, 'REJECTED');
    expect(rejected.body.payment).toMatchObject({ refundState: 'FAILED', refundFailureCode: 'REFUND_PROVIDER_ERROR' });

    // The provider accepts it later; the sweep waits for each back-off before it tries again.
    await ctx.prisma.payment.updateMany({
      where: { orderId: { in: [declined.id, errored.id] } },
      data: { providerRef: 'pos-refund-later' },
    });
    const refunds = ctx.app.get(RefundsService);
    await refunds.sweep(new Date(Date.now() + 60_000));
    expect((await getOrder(declined.id)).status).toBe('CANCELLED_BY_RESTAURANT');
    expect((await getOrder(errored.id)).status).toBe('REJECTED');
    // The errored one tried once (5 min wait), the declined one twice (15 min wait).
    await refunds.sweep(new Date(Date.now() + 6 * 60_000));
    expect((await getOrder(errored.id)).status).toBe('REFUNDED');
    expect((await getOrder(declined.id)).status).toBe('CANCELLED_BY_RESTAURANT');
    await refunds.sweep(new Date(Date.now() + 16 * 60_000));
    const done = await getOrder(declined.id);
    expect(done.status).toBe('REFUNDED');
    expect(done.payment).toMatchObject({ refundState: 'DONE', refundFailureCode: null });
  });

  it('refunds a completed order only on a staff request with a reason and tells the customer', async () => {
    const order = await paidOrder('pos-refund-2');
    await complete(order.id);
    const completed = await getOrder(order.id);
    expect(completed.payment).toMatchObject({ refundState: 'NONE', refundable: true, dueMinor: 0 });

    const bare = await transition(order.id, 'REFUNDED', {}, 409);
    expect(bare.body.code).toBe('REFUND_NOT_ALLOWED');
    await refund(order.id, {}, 400);
    await refund(order.id, { reason: 'Eksik urun' }, 403, courierToken);

    const before = await smsCount('order.refunded');
    const res = await refund(order.id, { reason: 'Eksik urun' }, 200);
    expect(res.body.status).toBe('REFUNDED');
    expect(res.body.payment).toMatchObject({ refundState: 'DONE', refundedMinor: order.chargedToCustomerMinor });
    const last = res.body.history[res.body.history.length - 1];
    expect(last).toMatchObject({ to: 'REFUNDED', reason: 'Eksik urun' });
    expect(await smsCount('order.refunded')).toBe(before + 1);

    const again = await refund(order.id, { reason: 'Eksik urun' }, 409);
    expect(again.body.code).toBe('REFUND_NOT_ALLOWED');
  });

  it('never refunds money taken at the door by itself and records it as given back by hand on request', async () => {
    const order = await createOrder({ method: 'CASH_ON_DELIVERY' });
    await transition(order.id, 'ACCEPTED', { prepMinutes: 5 });
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${order.id}/collect`)
      .set(bearer(ownerToken))
      .send({ method: 'CASH_ON_DELIVERY' })
      .expect(200);
    const cancelled = await transition(order.id, 'CANCELLED_BY_RESTAURANT', { reason: 'Musteri vazgecti' });
    expect(cancelled.body.status).toBe('CANCELLED_BY_RESTAURANT');
    expect(cancelled.body.payment).toMatchObject({ refundState: 'NONE', refundable: true });

    const res = await refund(order.id, { reason: 'Nakit iade edildi' }, 200);
    expect(res.body.status).toBe('REFUNDED');
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment).toMatchObject({ status: 'REFUNDED', refundProviderRef: null });

    // An unpaid cancelled order has nothing to give back.
    const unpaid = await createOrder({ method: 'CASH_ON_DELIVERY' });
    await transition(unpaid.id, 'REJECTED');
    expect((await refund(unpaid.id, { reason: 'Yok' }, 409)).body.code).toBe('REFUND_NOT_ALLOWED');
  });

  it('closes the order when the provider reports a refund made in its own dashboard, once', async () => {
    const order = await paidOrder('pos-refund-3');
    await complete(order.id);
    const notice = { providerRef: 'pos-refund-3', orderRef: order.id, amountMinor: order.chargedToCustomerMinor };
    await posWebhook({ ...notice, status: 'REFUNDED' });
    await posWebhook({ ...notice, status: 'REFUNDED' });
    // A late capture notice never undoes it.
    await posWebhook({ ...notice, status: 'CAPTURED' });
    const after = await getOrder(order.id);
    expect(after.status).toBe('REFUNDED');
    expect(after.payment.refundState).toBe('DONE');
    expect(after.history.filter((h: { to: string }) => h.to === 'REFUNDED')).toHaveLength(1);
  });

  it('takes a PLATFORM_PSP refund out of the payout only after completion', async () => {
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'PLATFORM_PSP' } });
    try {
      // The platform's own merchant captured it (its webhook arrives with the PSP contract, B4).
      const capture = async (providerRef: string) => {
        const order = await createOrder({ method: 'ONLINE_CARD' });
        await ctx.prisma.payment.updateMany({
          where: { orderId: order.id },
          data: { status: 'CAPTURED', providerRef, capturedAt: new Date() },
        });
        await ctx.prisma.order.update({ where: { id: order.id }, data: { status: 'PLACED' } });
        return order;
      };

      const early = await capture('psp-refund-1');
      expect((await transition(early.id, 'REJECTED')).body.status).toBe('REFUNDED');
      expect(await ctx.prisma.ledgerEntry.count({ where: { orderId: early.id } })).toBe(0);

      const late = await capture('psp-refund-2');
      await complete(late.id);
      expect(await ctx.prisma.ledgerEntry.count({ where: { orderId: late.id, type: 'RESTAURANT_PAYABLE' } })).toBe(1);
      await refund(late.id, { reason: 'Musteri sikayeti' }, 200);
      const lines = await ctx.prisma.ledgerEntry.findMany({ where: { orderId: late.id, type: 'REFUND' } });
      expect(lines).toHaveLength(1);
      expect(lines[0].amountMinor).toBe(-late.chargedToCustomerMinor);
    } finally {
      await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    }
  });
  it('keeps the commission of an order refunded after completion, and charges none for a cancelled one', async () => {
    const now = new Date();
    const period = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
    const statement = async () =>
      (
        await ctx
          .http()
          .get(`/restaurants/${restaurantId}/payments/commission`)
          .query(period)
          .set(bearer(ownerToken))
          .expect(200)
      ).body as { lines: { orderId: string }[] };

    const completed = await paidOrder('pos-commission-1');
    await complete(completed.id);
    await refund(completed.id, { reason: 'Musteri sikayeti' }, 200);
    const cancelled = await paidOrder('pos-commission-2');
    expect((await transition(cancelled.id, 'REJECTED')).body.status).toBe('REFUNDED');

    // Refunds are the restaurant's cost by contract: the completed one stays on the invoice, the cancelled one never was.
    const lines = (await statement()).lines.map((l) => l.orderId);
    expect(lines).toContain(completed.id);
    expect(lines).not.toContain(cancelled.id);
  });

  it('takes a chargeback on platform-collected money out of the payout once, and keeps the commission', async () => {
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'PLATFORM_PSP' } });
    try {
      const order = await createOrder({ method: 'ONLINE_CARD' });
      await ctx.prisma.payment.updateMany({
        where: { orderId: order.id },
        data: { status: 'CAPTURED', providerRef: 'psp-chargeback-1', capturedAt: new Date() },
      });
      await ctx.prisma.order.update({ where: { id: order.id }, data: { status: 'PLACED' } });
      await complete(order.id);
      expect(await ctx.prisma.ledgerEntry.count({ where: { orderId: order.id, type: 'RESTAURANT_PAYABLE' } })).toBe(1);

      // The PSP's notice (the platform PSP webhook arrives with its contract; the handler is the same).
      const notice = {
        providerRef: 'psp-chargeback-1',
        orderRef: order.id,
        status: 'CHARGEBACK',
        amountMinor: order.chargedToCustomerMinor,
      };
      expect((await posWebhook(notice)).body.status).toBe('CHARGEBACK');
      await posWebhook(notice);
      await posWebhook({ ...notice, status: 'CAPTURED' });

      const lines = await ctx.prisma.ledgerEntry.findMany({ where: { orderId: order.id, type: 'CHARGEBACK' } });
      expect(lines).toHaveLength(1);
      expect(lines[0].amountMinor).toBe(-order.chargedToCustomerMinor);
      const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(payment.status).toBe('CHARGED_BACK');
      // The commission lines of the completed order stay; nothing is due at the door and nothing can be refunded twice.
      expect(await ctx.prisma.ledgerEntry.count({ where: { orderId: order.id, type: 'PLATFORM_COMMISSION' } })).toBe(1);
      const detail = await getOrder(order.id);
      expect(detail.status).toBe('PICKED_UP');
      expect(detail.payment).toMatchObject({ dueMinor: 0, refundable: false });
      expect((await refund(order.id, { reason: 'Tekrar' }, 409)).body.code).toBe('REFUND_NOT_ALLOWED');
      expect(await ctx.prisma.auditLog.count({ where: { action: 'payment.charged_back', entityId: payment.id } })).toBe(
        1,
      );
    } finally {
      await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    }
  });
});
