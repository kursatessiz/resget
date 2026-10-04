import { z } from 'zod';
import { OrderRefundSource, OrderStatus, PaymentMethod } from './enums';
import { shareOf } from './money';
import { UuidSchema } from './validators';

/**
 * Refunds (docs/ODEME.md, "İade"). Money always goes back the way it came:
 * an online payment through the gateway or meal card issuer that captured
 * it, a payment taken at the door by the restaurant's own hand (the
 * platform only records it). A refund gives back the whole remaining
 * amount, or on a completed order part of it: chosen items or an amount
 * (docs/ODEME.md, "Kısmi iade"). The restaurant bears every refund and the
 * platform gives back the refunded share of its commission
 * (docs/MUTABAKAT.md, "Kısmi iade").
 *
 * - A rejected or cancelled order with a captured online payment is
 *   refunded automatically right after the cancellation; a failed attempt
 *   is retried with back-off and can always be retried by staff.
 * - A completed order is refunded only when staff with `orders.refund`
 *   asks for it, with a reason.
 * - An order becomes REFUNDED once every captured payment is refunded.
 */

export type RefundState = 'NONE' | 'PENDING' | 'FAILED' | 'DONE';
export type OrderRefundSourceValue = `${OrderRefundSource}`;

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

/** Only a completed order can be refunded in part; a cancelled one gives everything back. */
export const PARTIAL_REFUND_ORDER_STATUSES: readonly OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.PICKED_UP];

export const RefundItemSchema = z
  .object({ orderItemId: UuidSchema, quantity: z.number().int().min(1).max(999) })
  .strict();
export type RefundItem = z.infer<typeof RefundItemSchema>;

/**
 * A staff refund: without items or an amount it gives back everything that
 * is left; with items, what the customer paid for them; with an amount,
 * that much. Items and an amount are never sent together.
 */
export const RefundOrderSchema = z
  .object({
    reason: z.string().trim().min(1).max(300),
    items: z.array(RefundItemSchema).min(1).max(100).optional(),
    amountMinor: z.number().int().positive().optional(),
  })
  .strict()
  .refine((v) => !(v.items && v.amountMinor !== undefined), {
    message: 'Send items or an amount, not both',
    path: ['amountMinor'],
  })
  .refine((v) => !v.items || new Set(v.items.map((i) => i.orderItemId)).size === v.items.length, {
    message: 'Each item once',
    path: ['items'],
  });
export type RefundOrderInput = z.infer<typeof RefundOrderSchema>;

/** One refund as the screens show it: what went back, why, and the commission the platform gave back with it. */
export interface OrderRefundDTO {
  id: string;
  source: OrderRefundSourceValue;
  amountMinor: number;
  currency: string;
  /** Commission and its VAT given back to the restaurant for this refund (0 before completion). */
  commissionMinor: number;
  commissionVatMinor: number;
  items: { orderItemId: string; name: string; quantity: number }[];
  reason: string | null;
  createdAt: string;
}

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

// -- Partial refunds (docs/ODEME.md "Kısmi iade", docs/MUTABAKAT.md "Kısmi iade") --------------

/** An order line as the refund rules read it. */
export interface RefundableLine {
  id: string;
  quantity: number;
  lineTotalMinor: number;
}

/** How many of each line earlier refunds already gave back. */
export function refundedQuantities(refunds: readonly { items: readonly RefundItem[] | null }[]): Map<string, number> {
  const given = new Map<string, number>();
  for (const refund of refunds) {
    for (const item of refund.items ?? [])
      given.set(item.orderItemId, (given.get(item.orderItemId) ?? 0) + item.quantity);
  }
  return given;
}

/**
 * What the customer paid for the chosen items: each line's price for the
 * chosen quantity, scaled by the order-level discount the customer got
 * (the paid share of the items). Null when an item is not on the order or
 * more is asked than is left to give back. The delivery fee is never part
 * of an item refund.
 */
export function itemsRefundMinor(
  order: { itemsGrossMinor: number; discountMinor: number },
  lines: readonly RefundableLine[],
  selection: readonly RefundItem[],
  alreadyRefunded: ReadonlyMap<string, number>,
): number | null {
  let grossMinor = 0;
  for (const item of selection) {
    const line = lines.find((l) => l.id === item.orderItemId);
    if (!line) return null;
    if (item.quantity > line.quantity - (alreadyRefunded.get(line.id) ?? 0)) return null;
    grossMinor += shareOf(line.lineTotalMinor, item.quantity, line.quantity);
  }
  if (order.discountMinor <= 0) return grossMinor;
  return shareOf(grossMinor, order.itemsGrossMinor - order.discountMinor, order.itemsGrossMinor);
}

/** The commission figures of an order and whether it ever charged them (only a completed order does). */
export interface RefundCommissionBasis {
  completed: boolean;
  platformCommissionMinor: number;
  commissionVatMinor: number;
  /** What the customer paid; a refund carries commission in proportion to it. */
  chargedToCustomerMinor: number;
}

export interface RefundCommissionShare {
  commissionMinor: number;
  commissionVatMinor: number;
}

/**
 * The commission and VAT a refund gives back to the restaurant
 * (docs/MUTABAKAT.md, "Kısmi iade"): the refunded share of what the
 * customer paid, cumulative over the order's refunds so rounding never
 * drifts (the shares of all refunds of an order add up to its commission).
 * The last refund of an order and a chargeback give back whatever is left.
 * Before completion an order carries no commission, so nothing comes back.
 */
export function refundCommissionShare(
  order: RefundCommissionBasis,
  earlier: readonly { amountMinor: number; commissionMinor: number; commissionVatMinor: number }[],
  amountMinor: number,
  final: boolean,
): RefundCommissionShare {
  if (!order.completed) return { commissionMinor: 0, commissionVatMinor: 0 };
  const returnedCommission = earlier.reduce((n, r) => n + r.commissionMinor, 0);
  const returnedVat = earlier.reduce((n, r) => n + r.commissionVatMinor, 0);
  const leftCommission = Math.max(0, order.platformCommissionMinor - returnedCommission);
  const leftVat = Math.max(0, order.commissionVatMinor - returnedVat);
  if (final) return { commissionMinor: leftCommission, commissionVatMinor: leftVat };
  const before = earlier.reduce((n, r) => n + r.amountMinor, 0);
  const after = before + amountMinor;
  const total = order.chargedToCustomerMinor;
  const step = (amount: number) => shareOf(amount, after, total) - shareOf(amount, before, total);
  return {
    commissionMinor: Math.min(leftCommission, Math.max(0, step(order.platformCommissionMinor))),
    commissionVatMinor: Math.min(leftVat, Math.max(0, step(order.commissionVatMinor))),
  };
}

/**
 * How a partial amount is taken from an order's payments: online ones
 * first (the money goes back the way it came), then the ones taken at the
 * door, each in the order it was paid. Null when the payments cannot cover
 * the amount.
 */
export function allocateRefund<T extends RefundablePayment & { id: string }>(
  payments: readonly T[],
  amountMinor: number,
  now: Date,
): { payment: T; amountMinor: number }[] | null {
  const open = payments.filter((p) => refundableMinor(p) > 0 && !isRefundClaimLive(p.refundRequestedAt, now));
  const ordered = [...open.filter((p) => isOnlinePayment(p)), ...open.filter((p) => !isOnlinePayment(p))];
  const plan: { payment: T; amountMinor: number }[] = [];
  let left = amountMinor;
  for (const payment of ordered) {
    if (left === 0) break;
    const take = Math.min(left, refundableMinor(payment));
    plan.push({ payment, amountMinor: take });
    left -= take;
  }
  return left === 0 ? plan : null;
}
