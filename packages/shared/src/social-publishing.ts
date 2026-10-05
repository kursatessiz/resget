import { z } from 'zod';
import type { SocialAccountKind } from './social';

/**
 * Social publishing (docs/SOSYAL_YAYIN.md, module social_publishing). A
 * post is written once and published to the connected Facebook pages and
 * Instagram business accounts the tenant picks, now or at a set time. Each
 * account is a target with its own outcome, so one failing account never
 * hides the others. Instagram only takes posts with an image.
 */

export const SOCIAL_POST_STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED'] as const;
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];

/** Statuses in which a post can be edited, as long as no run has tried any of its accounts. */
export const EDITABLE_SOCIAL_POST_STATUSES = ['DRAFT', 'SCHEDULED'] as const satisfies readonly SocialPostStatus[];

export const SOCIAL_TARGET_STATUSES = ['PENDING', 'PUBLISHED', 'FAILED'] as const;
export type SocialTargetStatus = (typeof SOCIAL_TARGET_STATUSES)[number];

/** Instagram's caption limit; Facebook allows more, the post keeps to the stricter one. */
export const SOCIAL_POST_BODY_MAX = 2200;
/** Instagram refuses a caption with more hashtags than this. */
export const INSTAGRAM_HASHTAG_MAX = 30;
export const SOCIAL_POST_ACCOUNTS_MAX = 10;
/** Tries per account before the account's target counts as failed. */
export const SOCIAL_PUBLISH_MAX_ATTEMPTS = 3;
/** Minutes until a failed account is tried again. */
export const SOCIAL_PUBLISH_RETRY_MINUTES = 5;
/** How far ahead a post may be scheduled. */
export const SOCIAL_SCHEDULE_MAX_DAYS = 90;
export const SOCIAL_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const SOCIAL_POSTS_PAGE_SIZE = 20;

const AccountIds = z
  .array(z.string().uuid())
  .min(1)
  .max(SOCIAL_POST_ACCOUNTS_MAX)
  .refine((ids) => new Set(ids).size === ids.length, 'duplicate account');

export const SocialPostInputSchema = z
  .object({
    body: z.string().trim().min(1).max(SOCIAL_POST_BODY_MAX),
    accountIds: AccountIds,
  })
  .strict();
export type SocialPostInput = z.infer<typeof SocialPostInputSchema>;

export const ScheduleSocialPostSchema = z.object({ scheduledAt: z.string().datetime() }).strict();
export type ScheduleSocialPostInput = z.infer<typeof ScheduleSocialPostSchema>;

export const SocialPostsQuerySchema = z
  .object({ page: z.coerce.number().int().min(1).max(10_000).default(1) })
  .strict();
export type SocialPostsQuery = z.infer<typeof SocialPostsQuerySchema>;

/** Why a post cannot go out as it is; translated as socialPublishing.problem.<code>. */
export const SOCIAL_POST_PROBLEMS = ['INSTAGRAM_NEEDS_IMAGE', 'TOO_MANY_HASHTAGS'] as const;
export type SocialPostProblem = (typeof SOCIAL_POST_PROBLEMS)[number];

/** Hashtags as Instagram counts them: a # followed by a letter, digit or underscore. */
export function countHashtags(body: string): number {
  let count = 0;
  for (let i = 0; i < body.length - 1; i += 1) {
    if (body[i] === '#' && /[\p{L}\p{N}_]/u.test(body[i + 1])) count += 1;
  }
  return count;
}

/** The rules a post must meet for the accounts it targets; empty when it can be published. */
export function socialPostProblems(post: {
  body: string;
  hasImage: boolean;
  kinds: readonly SocialAccountKind[];
}): SocialPostProblem[] {
  const problems: SocialPostProblem[] = [];
  const instagram = post.kinds.includes('INSTAGRAM_BUSINESS');
  if (instagram && !post.hasImage) problems.push('INSTAGRAM_NEEDS_IMAGE');
  if (instagram && countHashtags(post.body) > INSTAGRAM_HASHTAG_MAX) problems.push('TOO_MANY_HASHTAGS');
  return problems;
}

/** Why one account's publish failed; translated as socialPublishing.reason.<code>. */
export const SOCIAL_TARGET_REASONS = ['ACCOUNT_UNAVAILABLE', 'GRAPH_ERROR', 'MODULE_OFF'] as const;
export type SocialTargetReason = (typeof SOCIAL_TARGET_REASONS)[number];

export interface SocialPostTargetDTO {
  /** Null after the account was disconnected; the name and kind stay as they were. */
  accountId: string | null;
  accountName: string;
  kind: SocialAccountKind;
  status: SocialTargetStatus;
  /** The post's id at the provider once published. */
  externalPostId: string | null;
  reason: SocialTargetReason | null;
  attempts: number;
  publishedAt: string | null;
}

export interface SocialPostDTO {
  id: string;
  body: string;
  imageUrl: string | null;
  status: SocialPostStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  targets: SocialPostTargetDTO[];
  /** Whether it can still be edited, given an image, scheduled or published: no run has touched it yet. */
  editable: boolean;
  /** What still keeps the post from going out (editable posts only). */
  problems: SocialPostProblem[];
}

export interface SocialPostPageDTO {
  items: SocialPostDTO[];
  total: number;
  page: number;
  pageSize: number;
}
