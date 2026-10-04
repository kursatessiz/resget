import {
  canStartRefund,
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
    expect(RefundOrderSchema.safeParse({ reason: 'x', amountMinor: 1 }).success).toBe(false);
  });
});
