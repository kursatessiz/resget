import { z } from 'zod';
import { RATING_MAX, RATING_MIN } from './ratings';

/**
 * Feedback routing and NPS (docs/GERI_BILDIRIM.md, module feedback, PRO
 * analytics). A low rating opens a case the staff follow up on; the review
 * invitation is shown to every customer who rated, whatever the score:
 * asking only happy customers ("review gating") is against Google's review
 * policy and consumer rules, and no incentive is ever offered for a review.
 * NPS is one question on the tracking page.
 */

export const FEEDBACK_CASE_STATUSES = ['OPEN', 'RESOLVED'] as const;
export type FeedbackCaseStatus = (typeof FEEDBACK_CASE_STATUSES)[number];

export const NPS_MIN = 0;
export const NPS_MAX = 10;
export const FEEDBACK_REPORT_RANGE_DAYS = [30, 90, 365] as const;

/** A public review page: https only, no credentials, any host the restaurant chooses (Google, a map listing). */
export const ReviewUrlSchema = z
  .string()
  .trim()
  .max(500)
  .url()
  // https, a host without user info (no "@" before the path), then any path.
  .regex(/^https:\/\/[^/@\s]+(?:\/\S*)?$/, 'https address without credentials');

export const UpdateFeedbackSettingsSchema = z
  .object({
    /** Where the "review us" button leads; null hides it. */
    reviewUrl: ReviewUrlSchema.nullable(),
    /** Ratings at or below this open a case and alert the staff. */
    alertMaxScore: z
      .number()
      .int()
      .min(RATING_MIN)
      .max(RATING_MAX - 2),
    npsEnabled: z.boolean(),
  })
  .strict();
export type UpdateFeedbackSettingsInput = z.infer<typeof UpdateFeedbackSettingsSchema>;

export const NpsAnswerSchema = z
  .object({
    score: z.number().int().min(NPS_MIN).max(NPS_MAX),
    comment: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type NpsAnswerInput = z.infer<typeof NpsAnswerSchema>;

export const UpdateFeedbackCaseSchema = z
  .object({
    status: z.enum(FEEDBACK_CASE_STATUSES),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();
export type UpdateFeedbackCaseInput = z.infer<typeof UpdateFeedbackCaseSchema>;

export type NpsCategory = 'PROMOTER' | 'PASSIVE' | 'DETRACTOR';

/** The standard NPS buckets: 9-10 promoters, 7-8 passives, 0-6 detractors. */
export function npsCategory(score: number): NpsCategory {
  if (score >= 9) return 'PROMOTER';
  if (score >= 7) return 'PASSIVE';
  return 'DETRACTOR';
}

/** Percent promoters minus percent detractors, rounded to a whole number; null without answers. */
export function npsScore(counts: { promoters: number; passives: number; detractors: number }): number | null {
  const total = counts.promoters + counts.passives + counts.detractors;
  if (total === 0) return null;
  return Math.round(((counts.promoters - counts.detractors) * 100) / total);
}

/** Whether a rating opens a case. */
export function isLowRating(score: number, alertMaxScore: number): boolean {
  return score <= alertMaxScore;
}

export interface FeedbackSettingsDTO extends UpdateFeedbackSettingsInput {
  updatedAt: string | null;
}

export interface FeedbackCaseDTO {
  id: string;
  orderId: string;
  shortCode: string;
  score: number;
  comment: string | null;
  status: FeedbackCaseStatus;
  note: string | null;
  /** Only with customers.contact.view, and never for a deleted account. */
  customer: { fullName: string; phone: string } | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface FeedbackOverviewDTO {
  days: number;
  ratings: { count: number; average: number | null; distribution: Record<'1' | '2' | '3' | '4' | '5', number> };
  nps: {
    score: number | null;
    promoters: number;
    passives: number;
    detractors: number;
    comments: { score: number; comment: string; createdAt: string }[];
  };
  openCases: number;
}
