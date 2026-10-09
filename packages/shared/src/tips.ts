import { z } from 'zod';
import { bpsOf, minorDigitsOf } from './money';
import { RATING_WINDOW_DAYS } from './ratings';
import type { HostedCheckoutSession } from './payments';

/**
 * Courier tips (docs/BAHSIS.md, module courier_tips). The customer tips the
 * courier from the tracking page after a delivery, never in the restaurant.
 * The platform takes no commission; only the fee of the provider that
 * collected the tip comes off it. The money always reaches the restaurant,
 * which hands it to its own courier, or a courier network that carried the
 * order and supports tips receives it through its API.
 */

/** Suggested tips as a share of what the customer paid for the order. */
export const TIP_PRESET_BPS = [500, 1000, 1500] as const;
/** A tip can be given for as long as the order can be rated. */
export const TIP_WINDOW_DAYS = RATING_WINDOW_DAYS;
export const TIP_REPORT_DEFAULT_DAYS = 30;

export const TIP_STATUSES = ['PENDING', 'CAPTURED', 'FAILED', 'REFUNDED', 'CHARGED_BACK'] as const;
export type TipStatus = (typeof TIP_STATUSES)[number];

export const TIP_PASS_THROUGH_STATUSES = ['SENT', 'FAILED'] as const;
export type TipPassThroughStatus = (typeof TIP_PASS_THROUGH_STATUSES)[number];

/** Whether a tip can still be given for an order completed at `completedAt`. */
export function withinTipWindow(completedAt: Date | string | null, now: Date = new Date()): boolean {
  if (!completedAt) return false;
  return now.getTime() - new Date(completedAt).getTime() <= TIP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** At least one major unit of the currency, at most what the customer paid for the order. */
export function tipLimits(orderTotalMinor: number, currency: string): { minMinor: number; maxMinor: number } {
  return { minMinor: 10 ** minorDigitsOf(currency), maxMinor: Math.max(0, orderTotalMinor) };
}

/** The suggested amounts: each preset share of the order total, within the limits, without repeats. */
export function tipPresets(orderTotalMinor: number, currency: string): number[] {
  const { minMinor, maxMinor } = tipLimits(orderTotalMinor, currency);
  if (maxMinor < minMinor) return [];
  const amounts = TIP_PRESET_BPS.map((bps) => Math.min(maxMinor, Math.max(minMinor, bpsOf(orderTotalMinor, bps))));
  return [...new Set(amounts)];
}

/** What reaches the courier: the tip less the provider's fee, never below zero. */
export function tipNetMinor(amountMinor: number, pspFeeMinor: number): number {
  return Math.max(0, amountMinor - pspFeeMinor);
}

// -- Writes -----------------------------------------------------------------------

export const StartTipSchema = z
  .object({
    amountMinor: z.number().int().positive(),
    returnUrl: z.string().url(),
  })
  .strict();
export type StartTipInput = z.infer<typeof StartTipSchema>;

/** A tip given back to the customer from the panel (docs/BAHSIS.md, "Panelden iade"): always the whole amount. */
export const RefundTipSchema = z.object({ reason: z.string().trim().min(1).max(300) }).strict();
export type RefundTipInput = z.infer<typeof RefundTipSchema>;

export const TipsReportQuerySchema = z
  .object({ days: z.coerce.number().int().min(1).max(365).default(TIP_REPORT_DEFAULT_DAYS) })
  .strict();
export type TipsReportQuery = z.infer<typeof TipsReportQuerySchema>;

// -- Reads ------------------------------------------------------------------------

/** What the tracking page offers; null when no tip can be given. */
export interface TipOfferDTO {
  currency: string;
  presetsMinor: number[];
  minMinor: number;
  maxMinor: number;
  /** The courier's first name, or the network's name when a network carried the order. */
  recipient: string;
}

/** The customer's tip on the tracking page. */
export interface TrackingTipDTO {
  status: TipStatus;
  amountMinor: number;
  currency: string;
}

export interface TipStartedDTO {
  tipId: string;
  session: HostedCheckoutSession;
}

export interface TipTotalsDTO {
  count: number;
  grossMinor: number;
  feeMinor: number;
  netMinor: number;
}

export interface CourierTipsRowDTO extends TipTotalsDTO {
  membershipId: string;
  name: string;
}

export interface NetworkTipsRowDTO extends TipTotalsDTO {
  providerCode: string;
  name: string;
  failedPassThrough: number;
}

export interface TipDTO {
  id: string;
  orderId: string;
  orderShortCode: string;
  status: TipStatus;
  amountMinor: number;
  pspFeeMinor: number;
  netMinor: number;
  currency: string;
  capturedAt: string | null;
  /** Own courier's name or the network's name. */
  recipient: string;
  /** Set for a tip that goes through a courier network. */
  passThroughStatus: TipPassThroughStatus | null;
  /** Why staff gave the tip back from the panel; null otherwise. */
  refundReason: string | null;
}

/** The courier's own tips in the app (courier mode): only what this courier delivered. */
export interface CourierTipsSummaryDTO {
  days: number;
  currency: string;
  totals: TipTotalsDTO;
  recent: TipDTO[];
}

export interface TipsReportDTO {
  days: number;
  currency: string;
  totals: TipTotalsDTO;
  couriers: CourierTipsRowDTO[];
  networks: NetworkTipsRowDTO[];
  recent: TipDTO[];
}
