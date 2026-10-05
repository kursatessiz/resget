import { z } from 'zod';
import type { OrderStatusValue } from './delivery';

/**
 * Order ratings (docs/VITRIN.md, "Değerlendirme"): one score per order, given
 * by the customer from the tracking page once the order is complete, within
 * a short window. The restaurant reads them in its reports; the marketplace
 * shows the average. A rating is the customer's word: staff cannot edit or
 * delete it, only read it.
 */

export const RATING_MIN = 1;
export const RATING_MAX = 5;
/** Days after completion during which the tracking page still offers the rating. */
export const RATING_WINDOW_DAYS = 7;
export const RATING_COMMENT_MAX = 300;

export const RateOrderSchema = z
  .object({
    score: z.number().int().min(RATING_MIN).max(RATING_MAX),
    comment: z.string().trim().min(1).max(RATING_COMMENT_MAX).optional(),
  })
  .strict();
export type RateOrderInput = z.infer<typeof RateOrderSchema>;

export interface OrderRatingDTO {
  score: number;
  comment: string | null;
  createdAt: string;
  /** Public reviews (docs/YORUMLAR.md): the last edit, until when the customer may still edit, the restaurant's answer. */
  editedAt: string | null;
  editableUntil: string | null;
  reply: { body: string; createdAt: string; editedAt: string | null } | null;
}

/** Average over a set of ratings, as the marketplace and the reports show it; null when nobody rated yet. */
export interface RatingSummaryDTO {
  average: number;
  count: number;
}

const RATEABLE: readonly OrderStatusValue[] = ['DELIVERED', 'PICKED_UP'];

/** A completed order may be rated once, within the window after completion. */
export function canRateOrder(
  status: OrderStatusValue,
  completedAt: Date | string | null,
  alreadyRated: boolean,
  now: Date = new Date(),
): boolean {
  if (alreadyRated || !completedAt || !RATEABLE.includes(status)) return false;
  const completed = new Date(completedAt).getTime();
  return now.getTime() - completed <= RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** Average to one decimal from a running sum and count; null without ratings. */
export function ratingSummary(sum: number, count: number): RatingSummaryDTO | null {
  if (count <= 0) return null;
  return { average: Math.round((sum / count) * 10) / 10, count };
}
