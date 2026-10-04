import { shareOf } from './money';
import {
  allocateRefund,
  canStartRefund,
  itemsRefundMinor,
  refundCommissionShare,
  refundedQuantities,
  isOnlinePayment,
  isRefundRetryDue,
  refundableMinor,
  refundStateOf,
  REFUND_CLAIM_STALE_MS,
  RefundOrderSchema,
} from './refunds';
import type { RefundablePayment } from './refunds';

const now = new Date('2026-10-04T12:00:00Z');
const payment = (over: Partial<RefundablePayment> = {}): RefundablePayment => ({
  method: 'ONLINE_CARD',
  status: 'CAPTURED',
  amountMinor: 25_000,
  refundedMinor: 0,
  collectedByUserId: null,
  refundRequestedAt: null,
  refundFailureCode: null,
  ...over,
});

describe('refund rules', () => {
  it('tells online money from money taken at the door', () => {
    expect(isOnlinePayment(payment())).toBe(true);
    expect(isOnlinePayment(payment({ method: 'MEAL_CARD' }))).toBe(true);
    expect(isOnlinePayment(payment({ method: 'MEAL_CARD', collectedByUserId: 'staff' }))).toBe(false);
    expect(isOnlinePayment(payment({ method: 'CASH_ON_DELIVERY', collectedByUserId: 'staff' }))).toBe(false);
  });

  it('refunds only what was captured and not yet given back', () => {
    expect(refundableMinor(payment())).toBe(25_000);
    expect(refundableMinor(payment({ status: 'PARTIALLY_REFUNDED', refundedMinor: 5_000 }))).toBe(20_000);
    expect(refundableMinor(payment({ status: 'PENDING' }))).toBe(0);
    expect(refundableMinor(payment({ status: 'REFUNDED', refundedMinor: 25_000 }))).toBe(0);
  });

  it('allows a refund on cancelled and completed orders only, never twice at once', () => {
    expect(canStartRefund('REJECTED', [payment()], now)).toBe(true);
    expect(canStartRefund('DELIVERED', [payment()], now)).toBe(true);
    expect(canStartRefund('PREPARING', [payment()], now)).toBe(false);
    expect(canStartRefund('REFUNDED', [payment()], now)).toBe(false);
    expect(canStartRefund('DELIVERED', [payment({ status: 'PENDING' })], now)).toBe(false);
    const inFlight = payment({ refundRequestedAt: new Date(now.getTime() - 1_000) });
    expect(canStartRefund('DELIVERED', [inFlight], now)).toBe(false);
    const stale = payment({ refundRequestedAt: new Date(now.getTime() - REFUND_CLAIM_STALE_MS) });
    expect(canStartRefund('DELIVERED', [stale], now)).toBe(true);
  });

  it('reports one state for the order', () => {
    expect(refundStateOf([payment()], now)).toBe('NONE');
    expect(refundStateOf([payment({ refundRequestedAt: now })], now)).toBe('PENDING');
    expect(refundStateOf([payment({ refundFailureCode: 'REFUND_DECLINED' })], now)).toBe('FAILED');
    expect(refundStateOf([payment({ status: 'REFUNDED', refundedMinor: 25_000 })], now)).toBe('DONE');
    expect(refundStateOf([payment({ status: 'FAILED' })], now)).toBe('NONE');
  });

  it('backs off between automatic retries and stops after the last wait', () => {
    expect(isRefundRetryDue(0, null, now)).toBe(true);
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    expect(isRefundRetryDue(1, minutesAgo(4), now)).toBe(false);
    expect(isRefundRetryDue(1, minutesAgo(5), now)).toBe(true);
    expect(isRefundRetryDue(4, minutesAgo(239), now)).toBe(false);
    expect(isRefundRetryDue(4, minutesAgo(240), now)).toBe(true);
    expect(isRefundRetryDue(5, minutesAgo(10_000), now)).toBe(false);
  });

  it('requires a reason', () => {
    expect(RefundOrderSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(RefundOrderSchema.safeParse({ reason: 'Eksik ürün' }).success).toBe(true);
    expect(RefundOrderSchema.safeParse({ reason: 'x', amountMinor: 1 }).success).toBe(true);
    expect(RefundOrderSchema.safeParse({ reason: 'x', amountMinor: 0 }).success).toBe(false);
    const item = { orderItemId: '6f1c2a7e-3b7c-4d9e-9a51-6b0f4f7d2c11', quantity: 1 };
    expect(RefundOrderSchema.safeParse({ reason: 'x', items: [item] }).success).toBe(true);
    expect(RefundOrderSchema.safeParse({ reason: 'x', items: [item], amountMinor: 1 }).success).toBe(false);
    expect(RefundOrderSchema.safeParse({ reason: 'x', items: [item, item] }).success).toBe(false);
    expect(RefundOrderSchema.safeParse({ reason: 'x', items: [] }).success).toBe(false);
  });
});

describe('shareOf', () => {
  it('rounds half up, caps the part at the whole and carries nothing of an empty whole', () => {
    expect(shareOf(1000, 1, 3)).toBe(333);
    expect(shareOf(1000, 2, 3)).toBe(667);
    expect(shareOf(5, 1, 2)).toBe(3);
    expect(shareOf(1000, 5, 3)).toBe(1000);
    expect(shareOf(1000, 0, 3)).toBe(0);
    expect(shareOf(1000, 1, 0)).toBe(0);
    expect(() => shareOf(1.5, 1, 2)).toThrow(RangeError);
  });
});

describe('partial refunds', () => {
  const lines = [
    { id: 'a', quantity: 2, lineTotalMinor: 30_000 },
    { id: 'b', quantity: 1, lineTotalMinor: 10_000 },
  ];

  it('prices chosen items at what the customer paid for them', () => {
    const none = new Map<string, number>();
    const order = { itemsGrossMinor: 40_000, discountMinor: 0 };
    expect(itemsRefundMinor(order, lines, [{ orderItemId: 'a', quantity: 1 }], none)).toBe(15_000);
    expect(
      itemsRefundMinor(
        order,
        lines,
        [
          { orderItemId: 'a', quantity: 2 },
          { orderItemId: 'b', quantity: 1 },
        ],
        none,
      ),
    ).toBe(40_000);
    // A 10% order discount: the customer paid 90% of each item.
    expect(
      itemsRefundMinor(
        { itemsGrossMinor: 40_000, discountMinor: 4_000 },
        lines,
        [{ orderItemId: 'b', quantity: 1 }],
        none,
      ),
    ).toBe(9_000);
  });

  it('refuses items not on the order and more than is left to give back', () => {
    const order = { itemsGrossMinor: 40_000, discountMinor: 0 };
    expect(itemsRefundMinor(order, lines, [{ orderItemId: 'x', quantity: 1 }], new Map())).toBeNull();
    expect(itemsRefundMinor(order, lines, [{ orderItemId: 'b', quantity: 2 }], new Map())).toBeNull();
    const given = refundedQuantities([{ items: [{ orderItemId: 'a', quantity: 1 }] }, { items: null }]);
    expect(given.get('a')).toBe(1);
    expect(itemsRefundMinor(order, lines, [{ orderItemId: 'a', quantity: 2 }], given)).toBeNull();
    expect(itemsRefundMinor(order, lines, [{ orderItemId: 'a', quantity: 1 }], given)).toBe(15_000);
  });

  it('gives back the refunded share of the commission, cumulatively, and the rest with the last refund', () => {
    const order = {
      completed: true,
      platformCommissionMinor: 100,
      commissionVatMinor: 20,
      chargedToCustomerMinor: 30_000,
    };
    const first = refundCommissionShare(order, [], 10_000, false);
    expect(first).toEqual({ commissionMinor: 33, commissionVatMinor: 7 });
    const earlier = [{ amountMinor: 10_000, ...first }];
    const second = refundCommissionShare(order, earlier, 10_000, false);
    expect(second).toEqual({ commissionMinor: 34, commissionVatMinor: 6 });
    const both = [...earlier, { amountMinor: 10_000, ...second }];
    // The last third gives back exactly what is left, so the shares add up to the order's commission.
    expect(refundCommissionShare(order, both, 10_000, false)).toEqual({ commissionMinor: 33, commissionVatMinor: 7 });
    expect(refundCommissionShare(order, both, 1, true)).toEqual({ commissionMinor: 33, commissionVatMinor: 7 });
    // A chargeback (final) after one partial refund gives back the rest.
    expect(refundCommissionShare(order, earlier, 20_000, true)).toEqual({
      commissionMinor: 67,
      commissionVatMinor: 13,
    });
  });

  it('gives nothing back before completion', () => {
    const order = { completed: false, platformCommissionMinor: 100, commissionVatMinor: 20, chargedToCustomerMinor: 1 };
    expect(refundCommissionShare(order, [], 1, true)).toEqual({ commissionMinor: 0, commissionVatMinor: 0 });
  });

  it('takes a partial amount from online payments first, then from the till', () => {
    const cash = { ...payment({ method: 'CASH_ON_DELIVERY', collectedByUserId: 'u', amountMinor: 5_000 }), id: 'cash' };
    const card = {
      ...payment({ amountMinor: 10_000, refundedMinor: 8_000, status: 'PARTIALLY_REFUNDED' }),
      id: 'card',
    };
    expect(allocateRefund([cash, card], 3_000, now)?.map((p) => [p.payment.id, p.amountMinor])).toEqual([
      ['card', 2_000],
      ['cash', 1_000],
    ]);
    expect(allocateRefund([cash, card], 7_001, now)).toBeNull();
    const held = { ...card, refundRequestedAt: new Date(now.getTime() - 1000) };
    expect(allocateRefund([cash, held], 3_000, now)?.map((p) => p.payment.id)).toEqual(['cash']);
  });
});
