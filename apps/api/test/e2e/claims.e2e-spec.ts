import { createHmac } from 'node:crypto';
import { PaymentMode } from '@resget/database';
import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const COURIER_PHONE = normalizePhone('05320000004')!;
const NOTE = 'e2e-claim';
const MERCHANT = 'merchant-claim';

/** Missing-item claims: the customer reports, the restaurant approves or declines (docs/ODEME.md). */
describe('Missing-item claims (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let courierToken: string;
  let restaurantId: string;
  let branchId: string;
  let menuItemId: string;
  let connectionId: string;
  let originalMode: PaymentMode;

  type Tracking = {
    items: { id: string; quantity: number; refundedQuantity: number }[];
    claim: {
      id: string;
      status: string;
      requestedMinor: number;
      refundedMinor: number;
      declineReason: string | null;
    } | null;
    canClaim: boolean;
  };
  type Detail = {
    status: string;
    openClaimId: string | null;
    claims: { id: string; status: string; refundedMinor: number }[];
    refunds: { source: string; amountMinor: number; commissionMinor: number }[];
    items: { id: string; lineTotalMinor: number; refundedQuantity: number }[];
  };

  const sign = (body: string) => createHmac('sha256', MERCHANT).update(body).digest('hex');
  const posWebhook = (payload: Record<string, unknown>) => {
    const body = JSON.stringify({ currency: 'TRY', pspFeeMinor: 0, occurredAt: new Date().toISOString(), ...payload });
    return ctx
      .http()
      .post(`/webhooks/payments/pos/${connectionId}`)
      .set('content-type', 'application/json')
      .set('x-mock-signature', sign(body))
      .send(body)
      .expect(200);
  };
  const transition = (orderId: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${orderId}/transition`)
      .set(bearer(ownerToken))
      .send({ to, ...extra })
      .expect(200);
  /** A paid online pickup order of two portions, completed; returns its id and tracking token. */
  const completedOrder = async (providerRef: string) => {
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken))
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity: 2 }],
        customer: { fullName: 'Eksik Musteri', phone: '0532 999 07 42' },
        note: NOTE,
        payment: { method: 'ONLINE_CARD' },
      })
      .expect(201);
    const order = created.body as { id: string; chargedToCustomerMinor: number };
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
    await transition(order.id, 'ACCEPTED', { prepMinutes: 5 });
    await transition(order.id, 'READY');
    await transition(order.id, 'PICKED_UP');
    const { trackingToken } = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { trackingToken: true },
    });
    return { id: order.id, token: trackingToken!, total: order.chargedToCustomerMinor };
  };
  const track = async (token: string) => (await ctx.http().get(`/public/orders/${token}`).expect(200)).body as Tracking;
  const file = (token: string, body: Record<string, unknown>, expected: number) =>
    ctx.http().post(`/public/orders/${token}/claims`).send(body).expect(expected);
  const decide = (
    orderId: string,
    claimId: string,
    action: 'approve' | 'decline',
    body: Record<string, unknown>,
    expected: number,
    token = ownerToken,
  ) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${orderId}/claims/${claimId}/${action}`)
      .set(bearer(token))
      .send(body)
      .expect(expected);
  const messages = (templateKey: string) =>
    ctx.prisma.messageLog.count({ where: { restaurantId, channel: { in: ['SMS', 'WHATSAPP'] }, templateKey } });
  const cleanup = () => ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });

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

  it('lets the customer report a missing portion once and the restaurant pay it out as a partial refund', async () => {
    const order = await completedOrder('pos-claim-1');
    const before = await track(order.token);
    expect(before).toMatchObject({ canClaim: true, claim: null });
    const line = before.items[0];

    // Only what is on the order, never more than was ordered.
    expect((await file(order.token, { items: [{ orderItemId: line.id, quantity: 3 }] }, 409)).body.code).toBe(
      'CLAIM_ITEMS_INVALID',
    );
    await file(order.token, { items: [] }, 400);

    const filed = (
      await file(order.token, { items: [{ orderItemId: line.id, quantity: 1 }], note: 'Bir porsiyon yok' }, 201)
    ).body as Tracking;
    expect(filed.canClaim).toBe(false);
    expect(filed.claim).toMatchObject({ status: 'OPEN', refundedMinor: 0 });
    expect(filed.claim!.requestedMinor).toBeGreaterThan(0);
    // One report waits at a time.
    expect((await file(order.token, { items: [{ orderItemId: line.id, quantity: 1 }] }, 409)).body.code).toBe(
      'CLAIM_NOT_ALLOWED',
    );

    const claimId = filed.claim!.id;
    const detail = (
      await ctx.http().get(`/restaurants/${restaurantId}/orders/${order.id}`).set(bearer(ownerToken)).expect(200)
    ).body as Detail;
    expect(detail.openClaimId).toBe(claimId);
    // A courier holds no orders.refund.
    await decide(order.id, claimId, 'approve', {}, 403, courierToken);
    // Never more than was claimed.
    expect(
      (await decide(order.id, claimId, 'approve', { items: [{ orderItemId: line.id, quantity: 2 }] }, 409)).body.code,
    ).toBe('CLAIM_ITEMS_INVALID');

    const partial = await messages('order.partiallyRefunded');
    const approved = (await decide(order.id, claimId, 'approve', {}, 200)).body as Detail;
    expect(approved.status).toBe('PICKED_UP');
    expect(approved.openClaimId).toBeNull();
    expect(approved.claims[0]).toMatchObject({
      id: claimId,
      status: 'APPROVED',
      refundedMinor: filed.claim!.requestedMinor,
    });
    expect(approved.refunds).toHaveLength(1);
    expect(approved.refunds[0]).toMatchObject({ source: 'CLAIM', amountMinor: filed.claim!.requestedMinor });
    expect(approved.refunds[0].commissionMinor).toBeGreaterThan(0);
    expect(approved.items[0].refundedQuantity).toBe(1);
    expect(await messages('order.partiallyRefunded')).toBe(partial + 1);
    expect((await decide(order.id, claimId, 'decline', { reason: 'Gec' }, 409)).body.code).toBe('CLAIM_NOT_OPEN');

    // The customer sees the outcome and may report the other portion.
    const after = await track(order.token);
    expect(after.claim).toMatchObject({ id: claimId, status: 'APPROVED' });
    expect(after.items[0].refundedQuantity).toBe(1);
    expect(after.canClaim).toBe(true);
  });

  it('declines a report with a reason the customer reads, and closes the window after a day', async () => {
    const order = await completedOrder('pos-claim-2');
    const line = (await track(order.token)).items[0];
    const filed = (await file(order.token, { items: [{ orderItemId: line.id, quantity: 2 }] }, 201)).body as Tracking;
    await decide(order.id, filed.claim!.id, 'decline', {}, 400);

    const declinedBefore = await messages('order.claimDeclined');
    const declined = (
      await decide(order.id, filed.claim!.id, 'decline', { reason: 'Paket eksiksiz teslim edildi' }, 200)
    ).body as Detail;
    expect(declined.claims[0]).toMatchObject({ status: 'DECLINED', refundedMinor: 0 });
    expect(declined.refunds).toHaveLength(0);
    expect(await messages('order.claimDeclined')).toBe(declinedBefore + 1);
    const seen = await track(order.token);
    expect(seen.claim).toMatchObject({ status: 'DECLINED', declineReason: 'Paket eksiksiz teslim edildi' });

    // A day after completion nothing more can be reported.
    await ctx.prisma.order.update({
      where: { id: order.id },
      data: { completedAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    expect((await track(order.token)).canClaim).toBe(false);
    expect((await file(order.token, { items: [{ orderItemId: line.id, quantity: 1 }] }, 409)).body.code).toBe(
      'CLAIM_NOT_ALLOWED',
    );
  });

  it('keeps the claim open when the refund does not go through', async () => {
    const order = await completedOrder('refund-decline-claim');
    const line = (await track(order.token)).items[0];
    const filed = (await file(order.token, { items: [{ orderItemId: line.id, quantity: 1 }] }, 201)).body as Tracking;
    expect((await decide(order.id, filed.claim!.id, 'approve', {}, 409)).body.code).toBe('REFUND_DECLINED');
    const claim = await ctx.prisma.orderClaim.findUniqueOrThrow({ where: { id: filed.claim!.id } });
    expect(claim).toMatchObject({ status: 'OPEN', decidedAt: null });
  });
});
