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
  const invoiceIds: string[] = [];
  let originalMode: PaymentMode;

  const createOrder = async (payment: Record<string, unknown>, quantity = 1) => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken))
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity }],
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
  /** The platform merchant's notice: it alone settles money the platform collected (PLATFORM_PSP). */
  const platformWebhook = (payload: Record<string, unknown>) => {
    const body = JSON.stringify({ currency: 'TRY', pspFeeMinor: 0, occurredAt: new Date().toISOString(), ...payload });
    return ctx
      .http()
      .post('/webhooks/payments/platform/MOCK')
      .set('content-type', 'application/json')
      .set('x-mock-signature', sign('mock', body))
      .send(body)
      .expect(200);
  };
  /** An online card order captured on the restaurant's own POS with the given provider reference. */
  const paidOrder = async (providerRef: string, quantity = 1) => {
    const order = await createOrder({ method: 'ONLINE_CARD' }, quantity);
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
    if (invoiceIds.length > 0) await ctx.prisma.commissionInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
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
      // No commission on a refunded order: its commission and VAT come back in the same payout.
      const snapshot = await ctx.prisma.order.findUniqueOrThrow({
        where: { id: late.id },
        select: { platformCommissionMinor: true, commissionVatMinor: true },
      });
      const reversal = await ctx.prisma.ledgerEntry.findMany({
        where: { orderId: late.id, type: { in: ['COMMISSION_REVERSAL', 'COMMISSION_VAT_REVERSAL'] } },
        orderBy: { type: 'asc' },
      });
      expect(reversal.map((l) => [l.type, l.amountMinor])).toEqual([
        ['COMMISSION_REVERSAL', snapshot.platformCommissionMinor],
        ['COMMISSION_VAT_REVERSAL', snapshot.commissionVatMinor],
      ]);
    } finally {
      await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    }
  });
  it('takes no commission on a refunded order and credits one already billed on the next invoice', async () => {
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
      ).body as {
        lines: { orderId: string }[];
        credits: { orderId: string }[];
        creditCommissionMinor: number;
        totalMinor: number;
      };

    // Refunded within the open month: never on the invoice.
    const refunded = await paidOrder('pos-commission-1');
    await complete(refunded.id);
    await refund(refunded.id, { reason: 'Musteri sikayeti' }, 200);
    expect((await statement()).lines.map((l) => l.orderId)).not.toContain(refunded.id);

    // Billed on last month's invoice, refunded now: credited on this month's, which has enough to absorb it.
    const billedEarlier = await paidOrder('pos-commission-2');
    await complete(billedEarlier.id);
    const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const invoice = await ctx.prisma.commissionInvoice.create({
      data: {
        restaurantId,
        periodStart: previous,
        periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        currency: 'TRY',
        orderCount: 1,
        baseMinor: 1,
        commissionMinor: 1,
        vatMinor: 0,
        totalMinor: 1,
        status: 'PAID',
      },
    });
    invoiceIds.push(invoice.id);
    await ctx.prisma.order.update({ where: { id: billedEarlier.id }, data: { commissionInvoiceId: invoice.id } });
    const first = await paidOrder('pos-commission-3');
    const second = await paidOrder('pos-commission-4');
    await complete(first.id);
    await complete(second.id);
    await refund(billedEarlier.id, { reason: 'Musteri sikayeti' }, 200);

    const open = await statement();
    expect(open.lines.map((l) => l.orderId)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(open.lines.map((l) => l.orderId)).not.toContain(billedEarlier.id);
    expect(open.credits.map((c) => c.orderId)).toContain(billedEarlier.id);
    expect(open.creditCommissionMinor).toBeGreaterThan(0);
    const settings = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/payments/settings`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(settings.body.accruedCommissionMinor).toBe((await statement()).totalMinor);
  });

  it('takes a chargeback on platform-collected money out of the payout once and gives the commission back', async () => {
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

      const notice = {
        providerRef: 'psp-chargeback-1',
        orderRef: order.id,
        status: 'CHARGEBACK',
        amountMinor: order.chargedToCustomerMinor,
      };
      // The restaurant's own POS cannot move money the platform collected.
      expect((await posWebhook(notice)).body.status).toBe('IGNORED');
      expect((await platformWebhook(notice)).body.status).toBe('CHARGEBACK');
      await platformWebhook(notice);
      await platformWebhook({ ...notice, status: 'CAPTURED' });

      const lines = await ctx.prisma.ledgerEntry.findMany({ where: { orderId: order.id, type: 'CHARGEBACK' } });
      expect(lines).toHaveLength(1);
      expect(lines[0].amountMinor).toBe(-order.chargedToCustomerMinor);
      const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(payment.status).toBe('CHARGED_BACK');
      // No commission on a charged-back order: it comes back once, next to the chargeback line.
      expect(await ctx.prisma.ledgerEntry.count({ where: { orderId: order.id, type: 'COMMISSION_REVERSAL' } })).toBe(1);
      const stamped = await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(stamped.commissionReversedAt).not.toBeNull();
      // Nothing is due at the door and nothing can be refunded twice.
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

  describe('partial refunds', () => {
    type Detail = {
      status: string;
      items: { id: string; quantity: number; refundedQuantity: number; lineTotalMinor: number }[];
      payment: { refundedMinor: number; refundable: boolean };
      refunds: {
        source: string;
        amountMinor: number;
        commissionMinor: number;
        commissionVatMinor: number;
        items: { orderItemId: string; quantity: number }[];
      }[];
    };
    const snapshotOf = (orderId: string) =>
      ctx.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { platformCommissionMinor: true, commissionVatMinor: true, commissionReversedAt: true },
      });

    it('gives back chosen items or an amount, keeps the order completed and returns the commission share', async () => {
      const order = await paidOrder('pos-partial-1', 2);
      await complete(order.id);
      const before = (await getOrder(order.id)) as Detail;
      const line = before.items[0];
      expect(line).toMatchObject({ quantity: 2, refundedQuantity: 0 });

      // Neither on a line the order does not have nor more than was ordered.
      const wrong = await refund(
        order.id,
        { reason: 'Eksik', items: [{ orderItemId: '6f1c2a7e-3b7c-4d9e-9a51-6b0f4f7d2c11', quantity: 1 }] },
        409,
      );
      expect(wrong.body.code).toBe('REFUND_ITEMS_INVALID');
      await refund(order.id, { reason: 'Eksik', items: [{ orderItemId: line.id, quantity: 1 }], amountMinor: 1 }, 400);
      await refund(order.id, { reason: 'Eksik', amountMinor: 100 }, 403, courierToken);

      const messages = await smsCount('order.partiallyRefunded');
      const res = await refund(
        order.id,
        { reason: 'Bir porsiyon eksik', items: [{ orderItemId: line.id, quantity: 1 }] },
        200,
      );
      const first = res.body as Detail;
      const half = line.lineTotalMinor / 2;
      expect(first.status).toBe('PICKED_UP');
      expect(first.payment).toMatchObject({ refundedMinor: half, refundable: true });
      expect(first.items[0].refundedQuantity).toBe(1);
      expect(first.refunds).toHaveLength(1);
      const snapshot = await snapshotOf(order.id);
      expect(first.refunds[0]).toMatchObject({
        source: 'STAFF',
        amountMinor: half,
        items: [{ orderItemId: line.id, quantity: 1 }],
        commissionMinor: Math.round((snapshot.platformCommissionMinor * half) / order.chargedToCustomerMinor),
      });
      expect(snapshot.commissionReversedAt).toBeNull();
      const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(payment).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedMinor: half });
      expect(await smsCount('order.partiallyRefunded')).toBe(messages + 1);

      // The same portion cannot go back twice, nor more money than is left.
      expect(
        (await refund(order.id, { reason: 'Eksik', items: [{ orderItemId: line.id, quantity: 2 }] }, 409)).body.code,
      ).toBe('REFUND_ITEMS_INVALID');
      const left = order.chargedToCustomerMinor - half;
      expect((await refund(order.id, { reason: 'Fazla', amountMinor: left + 1 }, 409)).body.code).toBe(
        'REFUND_AMOUNT_TOO_HIGH',
      );

      // An amount for the rest closes the order and gives back exactly what was left of the commission.
      const refundedBefore = await smsCount('order.refunded');
      const rest = (await refund(order.id, { reason: 'Kalan', amountMinor: left }, 200)).body as Detail;
      expect(rest.status).toBe('REFUNDED');
      expect(rest.refunds).toHaveLength(2);
      expect(rest.refunds.reduce((n, r) => n + r.commissionMinor, 0)).toBe(snapshot.platformCommissionMinor);
      expect(rest.refunds.reduce((n, r) => n + r.commissionVatMinor, 0)).toBe(snapshot.commissionVatMinor);
      expect((await snapshotOf(order.id)).commissionReversedAt).not.toBeNull();
      expect(await smsCount('order.refunded')).toBe(refundedBefore + 1);
    });

    it('refuses a partial refund before completion and records money given back from the till', async () => {
      const open = await paidOrder('pos-partial-2');
      expect((await refund(open.id, { reason: 'Erken', amountMinor: 100 }, 409)).body.code).toBe('REFUND_NOT_ALLOWED');
      await transition(open.id, 'REJECTED');

      const cash = await createOrder({ method: 'CASH_ON_DELIVERY' });
      await complete(cash.id);
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/orders/${cash.id}/collect`)
        .set(bearer(ownerToken))
        .send({ method: 'CASH_ON_DELIVERY' })
        .expect(200);
      const res = (await refund(cash.id, { reason: 'Elden iade', amountMinor: 500 }, 200)).body as Detail;
      expect(res.status).toBe('PICKED_UP');
      expect(res.payment.refundedMinor).toBe(500);
      const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: cash.id } });
      expect(payment).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundProviderRef: null });
    });

    it('credits a partial refund share on the month the order is billed in', async () => {
      const now = new Date();
      const statement = async () =>
        (
          await ctx
            .http()
            .get(`/restaurants/${restaurantId}/payments/commission`)
            .query({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 })
            .set(bearer(ownerToken))
            .expect(200)
        ).body as {
          lines: { orderId: string; commissionMinor: number }[];
          credits: { orderId: string; refundId: string; commissionMinor: number; commissionVatMinor: number }[];
          commissionMinor: number;
          creditCommissionMinor: number;
          totalMinor: number;
        };
      const order = await paidOrder('pos-partial-3', 2);
      await complete(order.id);
      const detail = (await getOrder(order.id)) as Detail;
      await refund(order.id, { reason: 'Eksik', items: [{ orderItemId: detail.items[0].id, quantity: 1 }] }, 200);
      const row = await ctx.prisma.orderRefund.findFirstOrThrow({ where: { orderId: order.id } });

      const open = await statement();
      // Billed in full this month, its refund's share credited on the same invoice.
      expect(open.lines.map((l) => l.orderId)).toContain(order.id);
      const credit = open.credits.find((c) => c.refundId === row.id);
      expect(credit).toMatchObject({ orderId: order.id, commissionMinor: row.commissionMinor });
      expect(row.commissionMinor).toBeGreaterThan(0);
      const charged = open.lines.reduce((n, l) => n + l.commissionMinor, 0);
      expect(open.commissionMinor).toBe(charged - open.creditCommissionMinor);
    });

    it('takes a PLATFORM_PSP partial refund out of the payout with its commission share', async () => {
      await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'PLATFORM_PSP' } });
      try {
        const order = await createOrder({ method: 'ONLINE_CARD' }, 2);
        await ctx.prisma.payment.updateMany({
          where: { orderId: order.id },
          data: { status: 'CAPTURED', providerRef: 'psp-partial-1', capturedAt: new Date() },
        });
        await ctx.prisma.order.update({ where: { id: order.id }, data: { status: 'PLACED' } });
        await complete(order.id);
        const detail = (await getOrder(order.id)) as Detail;
        const res = (
          await refund(order.id, { reason: 'Eksik', items: [{ orderItemId: detail.items[0].id, quantity: 1 }] }, 200)
        ).body as Detail;
        const share = res.refunds[0];
        const lines = await ctx.prisma.ledgerEntry.findMany({
          where: { orderId: order.id, type: { in: ['REFUND', 'COMMISSION_REVERSAL', 'COMMISSION_VAT_REVERSAL'] } },
          orderBy: { type: 'asc' },
        });
        expect(lines.map((l) => [l.type, l.amountMinor])).toEqual([
          ['REFUND', -share.amountMinor],
          ['COMMISSION_REVERSAL', share.commissionMinor],
          ['COMMISSION_VAT_REVERSAL', share.commissionVatMinor],
        ]);
      } finally {
        await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
      }
    });
  });
});
