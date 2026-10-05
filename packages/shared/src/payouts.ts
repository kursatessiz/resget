import { z } from 'zod';
import { LedgerEntryType, PayoutStatus } from './enums';
import type { PaymentModeValue } from './payments';
import type { SettlementLedgerLine } from './settlement';
import { PaginationSchema } from './validators';
import type { PayoutCadence } from './payout-schedules';

/**
 * Ledger and payouts (docs/MUTABAKAT.md, "Defter ve hakedis odemesi"). In
 * PLATFORM_PSP the platform holds the customer's money, so every completed
 * order writes its statement lines to the append-only ledger and the
 * RESTAURANT_PAYABLE lines of a week roll into one payout scheduled within
 * the legal window. OWN_POS orders never touch the ledger here: the
 * restaurant already has the money and its commission is booked by the
 * monthly invoice.
 */

/** Business days after a payout period closes before the money must be with the restaurant. */
export const PAYOUT_SETTLE_BUSINESS_DAYS_BY_COUNTRY: Readonly<Record<string, number>> = { TR: 5, DEFAULT: 7 };

export function payoutBusinessDaysFor(countryCode: string): number {
  return (
    PAYOUT_SETTLE_BUSINESS_DAYS_BY_COUNTRY[countryCode.toUpperCase()] ?? PAYOUT_SETTLE_BUSINESS_DAYS_BY_COUNTRY.DEFAULT
  );
}

/** Adds working days (Monday to Friday, UTC); public holidays are a regional adapter concern later. */
export function addBusinessDays(from: Date, days: number): Date {
  const date = new Date(from);
  let left = days;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return date;
}

/** The last complete Monday-to-Monday week (UTC) before the given moment. */
export function previousPayoutPeriod(now: Date): { periodStart: Date; periodEnd: Date } {
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const offset = (thisMonday.getUTCDay() + 6) % 7; // Monday = 0
  thisMonday.setUTCDate(thisMonday.getUTCDate() - offset);
  const periodStart = new Date(thisMonday.getTime() - 7 * 86_400_000);
  return { periodStart, periodEnd: thisMonday };
}

/** Ledger line types that make up what the platform owes the restaurant. */
export const PAYABLE_LINE_TYPES: readonly `${LedgerEntryType}`[] = [
  LedgerEntryType.RESTAURANT_PAYABLE,
  LedgerEntryType.REFUND,
  LedgerEntryType.CHARGEBACK,
  LedgerEntryType.COMMISSION_REVERSAL,
  LedgerEntryType.COMMISSION_VAT_REVERSAL,
  LedgerEntryType.ADJUSTMENT,
  LedgerEntryType.PAYOUT_FEE,
];

export interface OrderLedgerSnapshot {
  itemsGrossMinor: number;
  discountMinor: number;
  discountFundedBy: string | null;
  deliveryFeeMinor: number;
  courierCostMinor: number;
  courierBearer: string | null;
  platformCommissionMinor: number;
  commissionVatMinor: number;
  pspFeeMinor: number;
  withholdingMinor: number;
  restaurantPayableMinor: number;
}

/**
 * Rebuilds the statement lines of an order from its snapshot, the same way
 * the engine produced them. The snapshot's restaurantPayableMinor is the
 * truth: should the lines not add up to it (an older snapshot, a bearer the
 * snapshot does not keep), an ADJUSTMENT line closes the gap so the ledger
 * and the payout never drift from what the order promised.
 */
export function orderLedgerLines(order: OrderLedgerSnapshot): SettlementLedgerLine[] {
  const restaurantMovesFood = order.courierBearer !== 'PLATFORM';
  const lines: SettlementLedgerLine[] = [{ type: LedgerEntryType.GROSS_SALE, amountMinor: order.itemsGrossMinor }];
  if (order.discountFundedBy === 'RESTAURANT' && order.discountMinor > 0) {
    lines.push({ type: LedgerEntryType.DISCOUNT, amountMinor: -order.discountMinor });
  }
  if (restaurantMovesFood && order.deliveryFeeMinor > 0) {
    lines.push({ type: LedgerEntryType.DELIVERY_FEE, amountMinor: order.deliveryFeeMinor });
  }
  if (restaurantMovesFood && order.courierCostMinor > 0) {
    lines.push({ type: LedgerEntryType.COURIER_COST, amountMinor: -order.courierCostMinor });
  }
  if (order.platformCommissionMinor > 0) {
    lines.push({ type: LedgerEntryType.PLATFORM_COMMISSION, amountMinor: -order.platformCommissionMinor });
  }
  if (order.commissionVatMinor > 0)
    lines.push({ type: LedgerEntryType.COMMISSION_VAT, amountMinor: -order.commissionVatMinor });
  if (order.pspFeeMinor > 0) lines.push({ type: LedgerEntryType.PSP_FEE, amountMinor: -order.pspFeeMinor });
  if (order.withholdingMinor > 0)
    lines.push({ type: LedgerEntryType.WITHHOLDING_TAX, amountMinor: -order.withholdingMinor });
  const sum = lines.reduce((n, l) => n + l.amountMinor, 0);
  if (sum !== order.restaurantPayableMinor) {
    lines.push({ type: LedgerEntryType.ADJUSTMENT, amountMinor: order.restaurantPayableMinor - sum });
  }
  lines.push({ type: LedgerEntryType.RESTAURANT_PAYABLE, amountMinor: order.restaurantPayableMinor });
  return lines;
}

export interface LedgerEntryDTO {
  id: string;
  type: `${LedgerEntryType}`;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  orderId: string | null;
  orderShortCode: string | null;
  payoutId: string | null;
  invoiceId: string | null;
  memo: string | null;
}

export interface PayoutDTO {
  id: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: number;
  currency: string;
  status: `${PayoutStatus}`;
  scheduledFor: string;
  sentAt: string | null;
  settledAt: string | null;
  providerRef: string | null;
  failureReason: string | null;
  entryCount: number;
  createdAt: string;
  /** How the payout was made (docs/HAKEDIS_TAKVIMI.md) and the fee taken from it. */
  cadence: PayoutCadence;
  feeMinor: number;
}

export interface FinanceLedgerDTO {
  paymentMode: PaymentModeValue;
  currency: string;
  /** Payable lines not yet rolled into a payout. */
  pendingPayableMinor: number;
  entries: LedgerEntryDTO[];
  payouts: PayoutDTO[];
}

export interface AdminPayoutDTO extends PayoutDTO {
  restaurant: { id: string; name: string; slug: string };
}

export interface AdminPayoutPageDTO {
  items: AdminPayoutDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export const AdminPayoutQuerySchema = PaginationSchema.extend({
  status: z.nativeEnum(PayoutStatus).optional(),
}).strict();
export type AdminPayoutQuery = z.infer<typeof AdminPayoutQuerySchema>;

export const PayoutRunSchema = z.object({ asOf: z.string().datetime().optional() }).strict();

export interface PayoutRunReportDTO {
  asOf: string;
  periodStart: string;
  periodEnd: string;
  created: number;
  /** Sum of the new payouts per currency. */
  totals: { currency: string; amountMinor: number }[];
}

export const PayoutSentSchema = z.object({ providerRef: z.string().trim().min(2).max(120) }).strict();
export const PayoutFailedSchema = z.object({ reason: z.string().trim().min(2).max(300) }).strict();
