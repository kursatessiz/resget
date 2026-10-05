import { z } from 'zod';
import { CurrencyCodeSchema, MinorAmountSchema, bpsOf, netOfVat } from './money';

/**
 * Payout schedules (docs/HAKEDIS_TAKVIMI.md, module payout_schedules):
 * weekly as before, daily, or instant on request, each with a fee and a
 * settle delay that are platform data, and a plan rule (the fast_payouts
 * plan feature may waive the fee or be required). The fee is VAT included,
 * taken from the payout as a PAYOUT_FEE ledger line and shown on the monthly
 * commission invoice. PLATFORM_PSP restaurants only.
 */

export const PAYOUT_CADENCES = ['WEEKLY', 'DAILY', 'INSTANT'] as const;
export type PayoutCadence = (typeof PAYOUT_CADENCES)[number];
/** What a restaurant chooses as its schedule; an instant payout is a request, not a schedule. */
export const SCHEDULED_CADENCES = ['WEEKLY', 'DAILY'] as const;
export type ScheduledCadence = (typeof SCHEDULED_CADENCES)[number];

export interface PayoutScheduleOptionLike {
  feeBps: number;
  feeFixedMinor: number;
  freeWithFastPayouts: boolean;
}

/**
 * The fee of one payout: the rate of the amount plus the fixed part, never
 * more than the amount; nothing when the plan waives it or there is nothing
 * to pay.
 */
export function payoutFee(amountMinor: number, option: PayoutScheduleOptionLike, hasFastPayouts: boolean): number {
  if (amountMinor <= 0) return 0;
  if (option.freeWithFastPayouts && hasFastPayouts) return 0;
  return Math.min(amountMinor, bpsOf(amountMinor, option.feeBps) + option.feeFixedMinor);
}

/** The fee as the invoice shows it: the VAT-included amount split into net and VAT. */
export function payoutFeeInvoiceLine(feeGrossMinor: number, vatBps: number): { netMinor: number; vatMinor: number } {
  const netMinor = netOfVat(feeGrossMinor, vatBps);
  return { netMinor, vatMinor: feeGrossMinor - netMinor };
}

/** The UTC day before `now`: what a daily payout closes. */
export function previousPayoutDay(now: Date): { periodStart: Date; periodEnd: Date } {
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { periodStart: new Date(periodEnd.getTime() - 86_400_000), periodEnd };
}

// -- Console ---------------------------------------------------------------------

export const UpsertPayoutScheduleOptionSchema = z
  .object({
    cadence: z.enum(PAYOUT_CADENCES),
    currency: CurrencyCodeSchema,
    feeBps: z.number().int().min(0).max(1000),
    feeFixedMinor: MinorAmountSchema,
    settleBusinessDays: z.number().int().min(0).max(10),
    requiresFastPayouts: z.boolean(),
    freeWithFastPayouts: z.boolean(),
    isActive: z.boolean(),
  })
  .strict();
export type UpsertPayoutScheduleOptionInput = z.infer<typeof UpsertPayoutScheduleOptionSchema>;

export interface PayoutScheduleOptionDTO extends UpsertPayoutScheduleOptionInput {
  id: string;
}

// -- Restaurant ------------------------------------------------------------------

export const ChoosePayoutScheduleSchema = z.object({ cadence: z.enum(SCHEDULED_CADENCES) }).strict();
export type ChoosePayoutScheduleInput = z.infer<typeof ChoosePayoutScheduleSchema>;

/** One option as the restaurant sees it: whether it can use it and what it costs on its plan. */
export interface RestaurantPayoutOptionDTO {
  cadence: PayoutCadence;
  feeBps: number;
  feeFixedMinor: number;
  settleBusinessDays: number;
  /** The plan waives the fee. */
  free: boolean;
  /** The plan does not carry fast_payouts and the option needs it. */
  needsPlan: boolean;
}

export interface PayoutScheduleDTO {
  enabled: boolean;
  /** PLATFORM_PSP: the platform collects and pays out; OWN_POS restaurants have no payouts. */
  platformCollects: boolean;
  currency: string;
  cadence: ScheduledCadence;
  options: RestaurantPayoutOptionDTO[];
  pendingPayableMinor: number;
}

export interface InstantPayoutQuoteDTO {
  amountMinor: number;
  feeMinor: number;
  netMinor: number;
  currency: string;
}
