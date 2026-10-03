import { z } from 'zod';
import type { FulfillmentTypeValue, OrderChannelValue } from './delivery';

/**
 * Restaurant reports (docs/PANEL.md). BASIC sees the last 30 days; longer
 * ranges and the CSV export are the PRO `analytics` feature. Every number is
 * an aggregate of order snapshots, so a later price or rate change never
 * rewrites a past day.
 */

export const BASIC_REPORT_MAX_DAYS = 30;

export const ReportsQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(7) }).strict();
export type ReportsQuery = z.infer<typeof ReportsQuerySchema>;

export interface ReportBucketDTO {
  key: string;
  orders: number;
  grossMinor: number;
}

export interface ReportDayDTO {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string;
  orders: number;
  grossMinor: number;
}

export interface ReportTopItemDTO {
  name: string;
  quantity: number;
  grossMinor: number;
}

export interface ReportSummaryDTO {
  days: number;
  from: string;
  to: string;
  currency: string;
  completedOrders: number;
  cancelledOrders: number;
  /** Sum of what customers were charged on completed orders. */
  grossMinor: number;
  averageBasketMinor: number;
  /** Platform commission plus its VAT accrued on completed orders in the range. */
  commissionMinor: number;
  byFulfillment: (ReportBucketDTO & { key: FulfillmentTypeValue })[];
  byChannel: (ReportBucketDTO & { key: OrderChannelValue })[];
  topItems: ReportTopItemDTO[];
  daily: ReportDayDTO[];
  /** Ratings given in the range and the latest comments (docs/VITRIN.md). */
  ratings: { average: number | null; count: number; recent: ReportRatingDTO[] };
  /** True when the caller's plan allows longer ranges and the export. */
  analytics: boolean;
}

export interface ReportRatingDTO {
  shortCode: string;
  score: number;
  comment: string | null;
  createdAt: string;
}

/** Days a plan may look back; BASIC is capped, PRO sees the full year. */
export function reportDaysAllowed(days: number, analytics: boolean): boolean {
  return analytics || days <= BASIC_REPORT_MAX_DAYS;
}
