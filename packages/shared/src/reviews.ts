import { z } from 'zod';
import { REDACTION_MARK, redactPersonalData } from './ai-studio';
import { RATING_COMMENT_MAX, RATING_MAX, RATING_MIN } from './ratings';
import type { RatingSummaryDTO } from './ratings';

/**
 * Public reviews (docs/YORUMLAR.md, module public_reviews). An order rating
 * with its comment is shown on the restaurant's page; every review is shown,
 * whatever its score. The author appears with a short name (first name and
 * the initial of the last), and personal data in the text (phones, emails,
 * card or IBAN numbers, links) is masked on the public page. The customer
 * may edit their review for one day; the restaurant answers publicly and
 * may edit its answer for one day. The restaurant can report a review; the
 * platform owner hides it or dismisses the report. A hidden review leaves
 * the page and the average.
 */

export const REVIEW_EDIT_WINDOW_HOURS = 24;
export const REVIEW_REPLY_MAX = 500;
export const REVIEW_PAGE_SIZE = 20;

export const REVIEW_REPORT_REASONS = ['OFFENSIVE', 'PERSONAL_DATA', 'SPAM', 'NOT_A_CUSTOMER', 'OTHER'] as const;
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];

/** Whether something written at `writtenAt` can still be edited. */
export function withinEditWindow(writtenAt: Date | string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(writtenAt).getTime() <= REVIEW_EDIT_WINDOW_HOURS * 60 * 60 * 1000;
}

export function editableUntil(writtenAt: Date | string): Date {
  return new Date(new Date(writtenAt).getTime() + REVIEW_EDIT_WINDOW_HOURS * 60 * 60 * 1000);
}

/**
 * The name a review is signed with: the first name and the initial of the
 * last ("Ayse Yilmaz" -> "Ayse Y."); null when the order carried no name.
 * The initial is upper-cased with the restaurant's language, so a Turkish
 * "i" becomes "İ".
 */
export function reviewAuthorName(fullName: string | null | undefined, locale?: string): string | null {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0];
  if (parts.length === 1) return first;
  const initial = parts[parts.length - 1].charAt(0).toLocaleUpperCase(locale);
  return `${first} ${initial}.`;
}

/** Web and www addresses; bounded so a long word cannot make the pattern slow. */
const LINK = /\b(?:https?:\/\/|www\.)[^\s]{1,200}/gi;

/** Masks contact, payment and link text before a review is shown in public. */
export function scrubReviewText(text: string): string {
  const { text: redacted } = redactPersonalData(text);
  return redacted.replace(LINK, REDACTION_MARK);
}

// -- Writes -----------------------------------------------------------------------

/** The customer edits their review within the window; null clears the comment. */
export const EditRatingSchema = z
  .object({
    score: z.number().int().min(RATING_MIN).max(RATING_MAX).optional(),
    comment: z.string().trim().min(1).max(RATING_COMMENT_MAX).nullable().optional(),
  })
  .strict()
  .refine((value) => value.score !== undefined || value.comment !== undefined, { message: 'empty update' });
export type EditRatingInput = z.infer<typeof EditRatingSchema>;

export const ReviewReplySchema = z.object({ body: z.string().trim().min(1).max(REVIEW_REPLY_MAX) }).strict();
export type ReviewReplyInput = z.infer<typeof ReviewReplySchema>;

export const ReportReviewSchema = z
  .object({
    reason: z.enum(REVIEW_REPORT_REASONS),
    note: z.string().trim().max(300).nullable().default(null),
  })
  .strict();
export type ReportReviewInput = z.infer<typeof ReportReviewSchema>;

export const REVIEW_DECISIONS = ['HIDE', 'RESTORE', 'DISMISS'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const ReviewDecisionSchema = z
  .object({
    action: z.enum(REVIEW_DECISIONS),
    note: z.string().trim().max(300).nullable().default(null),
  })
  .strict();
export type ReviewDecisionInput = z.infer<typeof ReviewDecisionSchema>;

export const ReviewsQuerySchema = z.object({ cursor: z.string().uuid().optional() }).strict();
export type ReviewsQuery = z.infer<typeof ReviewsQuerySchema>;

export const ADMIN_REVIEW_FILTERS = ['REPORTED', 'HIDDEN'] as const;
export const AdminReviewsQuerySchema = z.object({ status: z.enum(ADMIN_REVIEW_FILTERS).default('REPORTED') }).strict();
export type AdminReviewsQuery = z.infer<typeof AdminReviewsQuerySchema>;

// -- Reads ------------------------------------------------------------------------

export interface ReviewReplyDTO {
  body: string;
  createdAt: string;
  editedAt: string | null;
}

/** A review as the restaurant's page shows it: short name, masked text. */
export interface PublicReviewDTO {
  id: string;
  score: number;
  comment: string | null;
  author: string | null;
  createdAt: string;
  editedAt: string | null;
  reply: ReviewReplyDTO | null;
}

export interface PublicReviewsPageDTO {
  summary: RatingSummaryDTO | null;
  items: PublicReviewDTO[];
  nextCursor: string | null;
}

/** The restaurant's view: the review as written, the answer and the moderation state. */
export interface PanelReviewDTO extends PublicReviewDTO {
  orderShortCode: string;
  /** Until when the answer can be edited; null before the first answer. */
  replyEditableUntil: string | null;
  canReply: boolean;
  report: { reason: ReviewReportReason; note: string | null; reportedAt: string; resolvedAt: string | null } | null;
  hiddenAt: string | null;
}

export interface PanelReviewsPageDTO {
  items: PanelReviewDTO[];
  nextCursor: string | null;
}

export interface AdminReviewDTO extends PanelReviewDTO {
  restaurant: { id: string; name: string; slug: string };
  hiddenReason: string | null;
}
