import { z } from 'zod';
import { OrderClaimStatus, OrderStatus } from './enums';
import { PARTIAL_REFUND_ORDER_STATUSES, RefundItemSchema } from './refunds';
import type { RefundItem } from './refunds';

/**
 * Missing-item claims (docs/ODEME.md, "Eksik ürün bildirimi"): the customer
 * says an item did not arrive, the restaurant approves (all or part of it)
 * or declines with a reason, and an approval gives the money back as a
 * partial refund of those items (source CLAIM). The restaurant bears it and
 * the platform gives back the refunded share of its commission, like any
 * partial refund (docs/MUTABAKAT.md, "Kısmi iade").
 */

export type OrderClaimStatusValue = `${OrderClaimStatus}`;

/** How long after completion the customer can report a missing item; the kitchen still remembers the order. */
export const CLAIM_WINDOW_HOURS = 24;
export const CLAIM_NOTE_MAX = 500;

/**
 * Escalation (docs/ODEME.md, "Eksik ürün bildirimi"; claim_escalation
 * module): a claim the restaurant has not decided within this many hours
 * moves to ESCALATED and the platform console can decide it. The restaurant
 * can still decide it meanwhile.
 */
export const CLAIM_DECISION_HOURS = 24;
/** Repeat-claimant warning: earlier claims of the customer at this restaurant within this window. */
export const REPEAT_CLAIM_WINDOW_DAYS = 90;
/** From this many earlier claims in the window, staff see the warning. */
export const REPEAT_CLAIM_THRESHOLD = 3;

/** Statuses in which a claim still waits for a decision. */
export const CLAIM_WAITING_STATUSES = [OrderClaimStatus.OPEN, OrderClaimStatus.ESCALATED] as const;

export function isClaimWaiting(status: string): boolean {
  return (CLAIM_WAITING_STATUSES as readonly string[]).includes(status);
}

/** Whether an open claim filed at this instant is due for escalation. */
export function claimEscalationDue(createdAt: Date | string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(createdAt).getTime() >= CLAIM_DECISION_HOURS * 3_600_000;
}

/** The customer's report from the tracking page: which items, how many, and an optional note. */
export const FileClaimSchema = z
  .object({
    items: z.array(RefundItemSchema).min(1).max(100),
    note: z.string().trim().min(1).max(CLAIM_NOTE_MAX).optional(),
  })
  .strict()
  .refine((v) => new Set(v.items.map((i) => i.orderItemId)).size === v.items.length, {
    message: 'Each item once',
    path: ['items'],
  });
export type FileClaimInput = z.infer<typeof FileClaimSchema>;

/** The restaurant approves what was claimed, or only part of it (never more). */
export const ApproveClaimSchema = z.object({ items: z.array(RefundItemSchema).min(1).max(100).optional() }).strict();
export type ApproveClaimInput = z.infer<typeof ApproveClaimSchema>;

/** A declined claim always says why; the customer reads the reason. */
export const DeclineClaimSchema = z.object({ reason: z.string().trim().min(1).max(300) }).strict();
export type DeclineClaimInput = z.infer<typeof DeclineClaimSchema>;

export interface OrderClaimDTO {
  id: string;
  status: OrderClaimStatusValue;
  items: { orderItemId: string; name: string; quantity: number }[];
  /** What the claimed items are worth at what the customer paid for them. */
  requestedMinor: number;
  /** What went back on approval (0 until then, or when declined). */
  refundedMinor: number;
  currency: string;
  note: string | null;
  declineReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** When the claim moved to the platform console; null while the restaurant alone decides. */
  escalatedAt: string | null;
}

/** The customer's earlier claims at this restaurant (repeat-claimant warning); shown to staff only. */
export interface CustomerClaimHistoryDTO {
  windowDays: number;
  /** Earlier claims in the window, this one excluded. */
  claims: number;
  approved: number;
  /** At or above REPEAT_CLAIM_THRESHOLD: the panel shows the warning. */
  repeat: boolean;
}

/** An escalated claim in the platform console. */
export interface AdminClaimDTO {
  id: string;
  orderId: string;
  orderShortCode: string;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  items: { orderItemId: string; name: string; quantity: number }[];
  requestedMinor: number;
  currency: string;
  note: string | null;
  createdAt: string;
  escalatedAt: string | null;
  /** The same customer's claims across every restaurant in the window, this one excluded. */
  platformHistory: { windowDays: number; claims: number; approved: number };
}

/**
 * Whether the customer may report missing items now: a completed order,
 * within the window, with no report already waiting for the restaurant
 * and something still to give back.
 */
export function canFileClaim(
  order: { status: string; completedAt: Date | string | null },
  openClaim: boolean,
  refundableMinor: number,
  now: Date = new Date(),
): boolean {
  if (openClaim || refundableMinor <= 0 || !order.completedAt) return false;
  if (!PARTIAL_REFUND_ORDER_STATUSES.includes(order.status as OrderStatus)) return false;
  return now.getTime() - new Date(order.completedAt).getTime() <= CLAIM_WINDOW_HOURS * 3_600_000;
}

/**
 * What an approval gives back: the claimed items, or the restaurant's
 * choice among them, never more than was claimed. Null when the choice
 * names an item that was not claimed or asks for more of one.
 */
export function approvedClaimItems(
  claimed: readonly RefundItem[],
  chosen: readonly RefundItem[] | undefined,
): RefundItem[] | null {
  if (!chosen) return [...claimed];
  for (const item of chosen) {
    const asked = claimed.find((c) => c.orderItemId === item.orderItemId);
    if (!asked || item.quantity > asked.quantity) return null;
  }
  return [...chosen];
}
