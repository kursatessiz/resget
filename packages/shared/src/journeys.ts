import { z } from 'zod';
import {
  CAMPAIGN_ATTRIBUTION_DAYS,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_EMAIL_BODY_MAX,
  CAMPAIGN_SUBJECT_MAX,
  campaignContentIssue,
} from './campaigns';
import type { CampaignChannel } from './campaigns';
import type { CampaignApprovalDTO } from './approvals';
import { UuidSchema } from './validators';

/**
 * Automated flows (docs/AKISLAR.md, module journeys): one message that a
 * trigger sends to one customer, later, through the same commercial sender
 * as campaigns (consent, registry, caps, send window, credits) and, under
 * marketing_approvals, the same four-eyes approval and 24-hour recipient
 * limit (docs/ONAYLAR.md). The trigger vocabulary lives here; the text, delay
 * and audience are tenant data.
 */

/**
 * ORDER_COMPLETED: every delivered or picked-up order. FIRST_ORDER: only the
 * customer's first. REVIEW_REQUEST: a completed order, with the link to rate
 * it. WIN_BACK: a customer whose last order is between N and 2N days old.
 */
export const JOURNEY_TRIGGERS = ['ORDER_COMPLETED', 'FIRST_ORDER', 'REVIEW_REQUEST', 'WIN_BACK'] as const;
export type JourneyTrigger = (typeof JOURNEY_TRIGGERS)[number];
export const ORDER_JOURNEY_TRIGGERS = ['ORDER_COMPLETED', 'FIRST_ORDER', 'REVIEW_REQUEST'] as const;

export const JOURNEY_STATUSES = ['ACTIVE', 'PAUSED'] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];

export const JOURNEY_RUN_STATUSES = ['PENDING', 'SENT', 'SKIPPED', 'FAILED', 'CANCELLED'] as const;
export type JourneyRunStatus = (typeof JOURNEY_RUN_STATUSES)[number];

/** Hours from the trigger to the message (up to 30 days). */
export const JOURNEY_DELAY_HOURS = { min: 0, max: 720 } as const;
export const JOURNEY_DEFAULT_DELAY_HOURS: Readonly<Record<JourneyTrigger, number>> = {
  ORDER_COMPLETED: 2,
  FIRST_ORDER: 24,
  REVIEW_REQUEST: 3,
  WIN_BACK: 0,
};
/** WIN_BACK: days without an order. */
export const JOURNEY_INACTIVE_DAYS = { min: 7, max: 365, default: 45 } as const;
/** No second message of the same flow to the same customer within this many days. */
export const JOURNEY_COOLDOWN_DAYS = { min: 0, max: 365, default: 30 } as const;
export const JOURNEY_BATCH_SIZE = 50;
/** WIN_BACK scans each active flow at most this often. */
export const JOURNEY_SCAN_INTERVAL_MINUTES = 60;

/** Placeholders a flow text may use; {link} only where the trigger is an order. */
export const JOURNEY_TOKENS = ['{name}', '{restaurant}', '{link}'] as const;

const JourneyBase = {
  name: z.string().trim().min(2).max(80),
  channel: z.enum(CAMPAIGN_CHANNELS),
  subject: z.string().trim().min(2).max(CAMPAIGN_SUBJECT_MAX).nullable().optional(),
  body: z.string().trim().min(5).max(CAMPAIGN_EMAIL_BODY_MAX),
  delayHours: z.number().int().min(JOURNEY_DELAY_HOURS.min).max(JOURNEY_DELAY_HOURS.max).optional(),
  inactiveDays: z.number().int().min(JOURNEY_INACTIVE_DAYS.min).max(JOURNEY_INACTIVE_DAYS.max).optional(),
  cooldownDays: z.number().int().min(JOURNEY_COOLDOWN_DAYS.min).max(JOURNEY_COOLDOWN_DAYS.max).optional(),
  attributionDays: z.number().int().min(CAMPAIGN_ATTRIBUTION_DAYS.min).max(CAMPAIGN_ATTRIBUTION_DAYS.max).optional(),
  /** A saved segment (segments v2) narrows who enters the flow. */
  segmentId: UuidSchema.nullable().optional(),
};

export interface JourneyContent {
  trigger: JourneyTrigger;
  channel: CampaignChannel;
  body: string;
  subject?: string | null;
}

/** Channel text rules as for campaigns, plus: {link} needs an order trigger. */
export function journeyContentIssue(
  content: JourneyContent,
): 'BODY_TOO_LONG' | 'SUBJECT_REQUIRED' | 'SUBJECT_NOT_ALLOWED' | 'LINK_NOT_AVAILABLE' | null {
  const issue = campaignContentIssue(content);
  if (issue) return issue;
  if (content.trigger === 'WIN_BACK' && content.body.includes('{link}')) return 'LINK_NOT_AVAILABLE';
  return null;
}

export const CreateJourneySchema = z
  .object({ ...JourneyBase, trigger: z.enum(JOURNEY_TRIGGERS) })
  .strict()
  .superRefine((value, ctx) => {
    const issue = journeyContentIssue(value);
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body'], message: issue });
  });
export type CreateJourneyInput = z.infer<typeof CreateJourneySchema>;

export const UpdateJourneySchema = z
  .object({
    name: JourneyBase.name.optional(),
    channel: JourneyBase.channel.optional(),
    subject: JourneyBase.subject,
    body: JourneyBase.body.optional(),
    delayHours: JourneyBase.delayHours,
    inactiveDays: JourneyBase.inactiveDays,
    cooldownDays: JourneyBase.cooldownDays,
    attributionDays: JourneyBase.attributionDays,
    segmentId: JourneyBase.segmentId,
    status: z.enum(JOURNEY_STATUSES).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'empty update' });
export type UpdateJourneyInput = z.infer<typeof UpdateJourneySchema>;

/** Fills the placeholders; an unknown or unavailable one stays out of the message. */
export function renderJourneyBody(
  body: string,
  values: { name: string; restaurant: string; link: string | null },
): string {
  return body
    .replaceAll('{name}', values.name)
    .replaceAll('{restaurant}', values.restaurant)
    .replaceAll('{link}', values.link ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** The first word of a full name, for a friendly greeting. */
export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}

export interface JourneyStatsDTO {
  pending: number;
  sent: number;
  skipped: number;
  failed: number;
  cancelled: number;
  /** Sent messages credited with the customer's next order (docs/KAMPANYALAR.md "Dönüşüm"). */
  conversions: number;
  revenueMinor: number;
}

export interface JourneyDTO {
  id: string;
  name: string;
  trigger: JourneyTrigger;
  channel: CampaignChannel;
  subject: string | null;
  body: string;
  delayHours: number;
  inactiveDays: number | null;
  cooldownDays: number;
  attributionDays: number;
  segmentId: string | null;
  status: JourneyStatus;
  /**
   * Send approval of the current content (docs/ONAYLAR.md). Under marketing_approvals an active flow sends only
   * while APPROVED; switching it on or changing what it sends asks for approval again.
   */
  approval: CampaignApprovalDTO;
  /**
   * Why the flow is not sending now: FEATURE_DISABLED, EMAIL_DOMAIN_NOT_VERIFIED, INSUFFICIENT_CREDITS,
   * JOURNEY_APPROVAL_REQUIRED or SEND_LIMIT_EXCEEDED (the tenant's rolling 24-hour recipient limit).
   */
  lastError: string | null;
  stats: JourneyStatsDTO;
  createdAt: string;
}

export interface JourneyListDTO {
  currency: string;
  /** The marketing_approvals module is on: active flows send only once another person approved them. */
  approvalRequired: boolean;
  items: JourneyDTO[];
}
