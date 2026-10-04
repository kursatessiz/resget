import { z } from 'zod';
import { OrderStatus, PaymentMethod } from './enums';

/**
 * Refunds (docs/ODEME.md, "İade"). Money always goes back the way it came:
 * an online payment through the gateway or meal card issuer that captured
 * it, a payment taken at the door by the restaurant's own hand (the
 * platform only records it). A refund is always the whole remaining amount
 * of a payment; a partial refund is a later item.
 *
 * - A rejected or cancelled order with a captured online payment is
 *   refunded automatically right after the cancellation; a failed attempt
 *   is retried with back-off and can always be retried by staff.
 * - A completed order is refunded only when staff with `orders.refund`
 *   asks for it, with a reason.
 * - An order becomes REFUNDED once every captured payment is refunded.
 */

export type RefundState = 'NONE' | 'PENDING' | 'FAILED' | 'DONE';

/** Cancellations that trigger the automatic refund of an online payment. */
export const AUTO_REFUND_STATUSES: readonly OrderStatus[] = [
  OrderStatus.REJECTED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_RESTAURANT,
];

/** Whether moving an order into this status refunds its online payment automatically. */
export function isAutoRefundStatus(status: OrderStatus | `${OrderStatus}`): boolean {
  return AUTO_REFUND_STATUSES.includes(status as OrderStatus);
}

/** Statuses from which a refund may start: a cancelled order or a completed one. */
export const REFUNDABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  ...AUTO_REFUND_STATUSES,
  OrderStatus.DELIVERED,
  OrderStatus.PICKED_UP,
];

/** A claimed refund whose gateway call never reported back is released after this long. */
export const REFUND_CLAIM_STALE_MS = 5 * 60_000;

/** Waits before each automatic retry (minutes after the previous attempt); after the last one staff decide. */
export const REFUND_RETRY_BACKOFF_MINUTES: readonly number[] = [5, 15, 60, 240];

export const RefundOrderSchema = z.object({ reason: z.string().trim().min(1).max(300) }).strict();
export type RefundOrderInput = z.infer<typeof RefundOrderSchema>;

/** The parts of a payment row the refund rules read. */
export interface RefundablePayment {
  method: string;
  status: string;
  amountMinor: number;
  refundedMinor: number;
  /** Set when staff or a courier recorded the payment at the door or the counter. */
  collectedByUserId: string | null;
  refundRequestedAt: Date | null;
  refundFailureCode: string | null;
}

/** Online means the money sits with a gateway or an issuer that can send it back; anything else is in the till. */
export function isOnlinePayment(payment: Pick<RefundablePayment, 'method' | 'collectedByUserId'>): boolean {
  return (
    payment.collectedByUserId === null &&
    (payment.method === PaymentMethod.ONLINE_CARD || payment.method === PaymentMethod.MEAL_CARD)
  );
}

/** What is still to be given back on a captured payment. */
export function refundableMinor(payment: Pick<RefundablePayment, 'status' | 'amountMinor' | 'refundedMinor'>): number {
  if (payment.status !== 'CAPTURED' && payment.status !== 'PARTIALLY_REFUNDED') return 0;
  return Math.max(0, payment.amountMinor - payment.refundedMinor);
}

/** Whether a claim is still held by an attempt in flight. */
export function isRefundClaimLive(requestedAt: Date | null, now: Date): boolean {
  return requestedAt !== null && now.getTime() - requestedAt.getTime() < REFUND_CLAIM_STALE_MS;
}

/** One state for the whole order, from its payments: what the screens show. */
export function refundStateOf(payments: readonly RefundablePayment[], now: Date): RefundState {
  const captured = payments.filter((p) => p.status === 'CAPTURED' || p.status === 'PARTIALLY_REFUNDED');
  if (captured.some((p) => isRefundClaimLive(p.refundRequestedAt, now))) return 'PENDING';
  if (captured.some((p) => p.refundFailureCode !== null)) return 'FAILED';
  if (captured.length === 0 && payments.some((p) => p.status === 'REFUNDED')) return 'DONE';
  return 'NONE';
}

/** Whether staff may start (or retry) a refund on an order in this status with these payments. */
export function canStartRefund(
  orderStatus: OrderStatus | `${OrderStatus}`,
  payments: readonly RefundablePayment[],
  now: Date,
): boolean {
  if (!REFUNDABLE_ORDER_STATUSES.includes(orderStatus as OrderStatus)) return false;
  return payments.some((p) => refundableMinor(p) > 0 && !isRefundClaimLive(p.refundRequestedAt, now));
}

/** Whether the automatic retry may try this payment again now. */
export function isRefundRetryDue(attempts: number, lastAttemptAt: Date | null, now: Date): boolean {
  if (attempts === 0 || lastAttemptAt === null) return true;
  const wait = REFUND_RETRY_BACKOFF_MINUTES[attempts - 1];
  if (wait === undefined) return false;
  return now.getTime() - lastAttemptAt.getTime() >= wait * 60_000;
}
