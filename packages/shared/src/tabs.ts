import { z } from 'zod';
import { CollectPaymentSchema } from './meal-cards';
import { shareOf } from './money';
import type { OrderStatusValue } from './delivery';

/**
 * Open tab at the table (docs/ACIK_HESAP.md, module table_tabs). A guest at
 * a table, or the waiter, can put dine-in orders on the table's open tab
 * instead of paying each one up front; paying per order stays an option.
 * The tab gathers every such order of the table until it is settled and
 * closed. The bill is paid at the table or the counter: staff collect it in
 * one go or in shares (split equally, by items or by amount) with cash, a
 * card on the restaurant's POS or a meal card, so the restaurant collects
 * the money itself (OWN_POS) and a dine-in order carries no commission.
 *
 * A collected share is spread over the tab's orders oldest first and
 * recorded as ordinary counter payments on those orders, so refunds,
 * reports and the accounting export keep working per order. There is no
 * service charge (none is levied in Turkey; the platform adds none).
 */

export const TAB_STATUSES = ['OPEN', 'CLOSED'] as const;
export type TabStatus = (typeof TAB_STATUSES)[number];

export const TAB_TOKEN_BYTES = 18;
export const TabTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{24}$/);

/** How many people a bill may be split between. */
export const TAB_SPLIT_MIN_PEOPLE = 2;
export const TAB_SPLIT_MAX_PEOPLE = 30;

export const TAB_SPLIT_MODES = ['EQUAL', 'ITEMS', 'AMOUNT'] as const;
export type TabSplitMode = (typeof TAB_SPLIT_MODES)[number];

/** Orders that no longer count on the bill: never served and owing nothing. */
const OFF_BILL: readonly OrderStatusValue[] = [
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_RESTAURANT',
  'REJECTED',
  'REFUNDED',
];

export function countsOnBill(status: OrderStatusValue): boolean {
  return !OFF_BILL.includes(status);
}

function assertMinor(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
}

/**
 * Splits an amount into equal shares in minor units. The remainder that
 * does not divide goes one unit at a time to the first shares, so the
 * shares always add up to the amount.
 */
export function splitEqual(totalMinor: number, people: number): number[] {
  assertMinor(totalMinor, 'totalMinor');
  if (!Number.isInteger(people) || people < 1) throw new RangeError('people must be a positive integer');
  const base = Math.floor(totalMinor / people);
  const remainder = totalMinor - base * people;
  return Array.from({ length: people }, (_, i) => base + (i < remainder ? 1 : 0));
}

export interface TabBillLineLike {
  id: string;
  totalMinor: number;
}

export interface ItemSplit {
  /** What each person pays, by person index. */
  shares: number[];
  /** Lines nobody took yet, and what they add up to. */
  unassignedLineIds: string[];
  unassignedMinor: number;
}

/**
 * Splits by items: each line goes to the people who had it, and a line
 * shared by several is split equally between them (splitEqual). A
 * restaurant-funded discount on the bill is carried by every share in
 * proportion to what it took (shareOf), the lines nobody took yet carry
 * the rest, so the shares and the unassigned part add up to the bill.
 */
export function splitByItems(
  lines: readonly TabBillLineLike[],
  people: number,
  assignment: Readonly<Record<string, readonly number[]>>,
  discountMinor = 0,
): ItemSplit {
  assertMinor(discountMinor, 'discountMinor');
  if (!Number.isInteger(people) || people < 1) throw new RangeError('people must be a positive integer');
  const shares = Array.from({ length: people }, () => 0);
  const unassignedLineIds: string[] = [];
  let unassignedMinor = 0;
  for (const line of lines) {
    assertMinor(line.totalMinor, 'line total');
    const takers = [...new Set(assignment[line.id] ?? [])].filter((p) => Number.isInteger(p) && p >= 0 && p < people);
    if (takers.length === 0) {
      unassignedLineIds.push(line.id);
      unassignedMinor += line.totalMinor;
      continue;
    }
    takers.sort((a, b) => a - b);
    splitEqual(line.totalMinor, takers.length).forEach((part, i) => {
      shares[takers[i]] += part;
    });
  }
  const grossMinor = shares.reduce((sum, s) => sum + s, 0) + unassignedMinor;
  const discount = Math.min(discountMinor, grossMinor);
  if (discount === 0) return { shares, unassignedLineIds, unassignedMinor };
  const parts = shares.map((share) => shareOf(discount, share, grossMinor));
  let rest = discount - parts.reduce((sum, d) => sum + d, 0);
  if (unassignedMinor > 0) {
    const taken = Math.min(rest, unassignedMinor);
    unassignedMinor -= taken;
    rest -= taken;
  }
  // Rounding left over with nothing unassigned lands on the last share that can carry it.
  for (let i = parts.length - 1; i >= 0 && rest !== 0; i--) {
    const room = shares[i] - parts[i];
    const move = rest > 0 ? Math.min(rest, room) : Math.max(rest, -parts[i]);
    parts[i] += move;
    rest -= move;
  }
  return { shares: shares.map((share, i) => share - parts[i]), unassignedLineIds, unassignedMinor };
}

export interface AmountSplit {
  ok: boolean;
  /** What is left after the given amounts; negative when they exceed the total. */
  remainingMinor: number;
}

/** Splits by amount: everyone names what they pay; the amounts may not exceed what is due. */
export function splitByAmount(dueMinor: number, amounts: readonly number[]): AmountSplit {
  assertMinor(dueMinor, 'dueMinor');
  for (const amount of amounts) assertMinor(amount, 'amount');
  const remainingMinor = dueMinor - amounts.reduce((sum, a) => sum + a, 0);
  return { ok: remainingMinor >= 0, remainingMinor };
}

export interface TabOrderDue {
  orderId: string;
  dueMinor: number;
}

/**
 * Spreads a collected share over the tab's orders, oldest first, never more
 * than an order still owes. Refused (RangeError) when the share exceeds what
 * the tab owes.
 */
export function allocateTabPayment(
  amountMinor: number,
  orders: readonly TabOrderDue[],
): { orderId: string; amountMinor: number }[] {
  assertMinor(amountMinor, 'amountMinor');
  const due = orders.reduce((sum, o) => sum + o.dueMinor, 0);
  if (amountMinor > due) throw new RangeError('amount exceeds what the tab owes');
  const parts: { orderId: string; amountMinor: number }[] = [];
  let left = amountMinor;
  for (const order of orders) {
    if (left === 0) break;
    const take = Math.min(left, order.dueMinor);
    if (take > 0) parts.push({ orderId: order.orderId, amountMinor: take });
    left -= take;
  }
  return parts;
}

// -- API -------------------------------------------------------------------------

/** A share collected at the table or the counter; the amount is required (a share, or the whole due). */
export const CollectTabPaymentSchema = CollectPaymentSchema.innerType()
  .extend({ amountMinor: z.number().int().positive() })
  .strict()
  .superRefine((value, ctx) => {
    if (value.method === 'MEAL_CARD' && !value.providerCode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['providerCode'], message: 'required for a meal card' });
    }
  });
export type CollectTabPaymentInput = z.infer<typeof CollectTabPaymentSchema>;

export interface TabBillLineDTO {
  id: string;
  orderShortCode: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  /** The line as charged, with its options. */
  totalMinor: number;
  modifiers: string[];
}

export interface TabOrderDTO {
  id: string;
  shortCode: string;
  status: OrderStatusValue;
  chargedToCustomerMinor: number;
  discountMinor: number;
  dueMinor: number;
  createdAt: string;
}

/** The bill: what the table had, what was paid and what is left. Shown to the table without personal data. */
export interface TabBillDTO {
  id: string;
  token: string;
  status: TabStatus;
  restaurantName: string;
  themePrimary: string;
  logoUrl: string | null;
  tableLabel: string;
  currency: string;
  openedAt: string;
  closedAt: string | null;
  lines: TabBillLineDTO[];
  orders: TabOrderDTO[];
  /** Restaurant-funded discounts on the tab's orders (loyalty, coupons). */
  discountMinor: number;
  totalMinor: number;
  paidMinor: number;
  dueMinor: number;
  /** Panel only: how the restaurant takes money at the counter; null on the table's own view. */
  collect: TabCollectOptionsDTO | null;
}

export interface TabCollectOptionsDTO {
  cash: boolean;
  card: boolean;
  mealCards: { providerCode: string; name: string }[];
}

export interface TabSummaryDTO {
  id: string;
  token: string;
  tableId: string;
  tableLabel: string;
  openedAt: string;
  orderCount: number;
  totalMinor: number;
  paidMinor: number;
  dueMinor: number;
  currency: string;
}
