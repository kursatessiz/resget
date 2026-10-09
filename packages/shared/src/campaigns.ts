import { z } from 'zod';
import type { CampaignApprovalDTO, CampaignGuardsDTO } from './approvals';
import { OrderChannel } from './enums';
import type { CampaignRecipientStatus, CampaignStatus } from './enums';
import { PaginationSchema, UuidSchema } from './validators';

/**
 * Marketing campaigns (docs/KAMPANYALAR.md), the heart of the PRO plan: a
 * restaurant writes one message and sends it to a segment of its own
 * customers. Three rules never bend: only customers who opted in receive
 * it, every message carries a one-click opt-out, and nothing goes out in
 * the quiet hours of the restaurant's own time zone. Each delivered message
 * costs one credit of the channel's wallet, through the same engine as an
 * order notification.
 */

export const CAMPAIGN_BODY_MAX = 300;
/** Campaigns v2 (docs/KAMPANYALAR.md, module campaigns_v2): email, A/B variants, send time, attribution. */
export const CAMPAIGN_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];
export const CAMPAIGN_EMAIL_BODY_MAX = 5000;
export const CAMPAIGN_SUBJECT_MAX = 120;
/** FIXED: everyone at the chosen moment. BEST_HOUR: each recipient at the local hour they order most often. */
export const CAMPAIGN_SEND_TIME_MODES = ['FIXED', 'BEST_HOUR'] as const;
export type CampaignSendTimeMode = (typeof CAMPAIGN_SEND_TIME_MODES)[number];
export const CAMPAIGN_VARIANTS = ['A', 'B'] as const;
export type CampaignVariant = (typeof CAMPAIGN_VARIANTS)[number];
/** Share of the audience that receives variant B, in percent. */
export const CAMPAIGN_VARIANT_SHARE = { min: 10, max: 90, default: 50 } as const;
/**
 * Automatic winner (docs/KAMPANYALAR.md): the share of the audience that tests, split evenly between the two texts,
 * and how long after the start the winner is picked. The rest waits as HOLD and gets the winner.
 */
export const CAMPAIGN_AUTO_WINNER = {
  testPct: { min: 10, max: 50, default: 20 },
  waitHours: { min: 1, max: 72, default: 24 },
} as const;
/** A recipient's side: A or B, or HOLD while it waits for the automatic winner. */
export type CampaignRecipientVariant = CampaignVariant | 'HOLD';
/** Days after a message within which the recipient's first order is credited to the campaign. */
export const CAMPAIGN_ATTRIBUTION_DAYS = { min: 1, max: 14, default: 3 } as const;
/** Orders that never became a sale do not count as conversions (campaigns and flows). */
export const CONVERSION_EXCLUDED_ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_RESTAURANT',
  'REJECTED',
  'REFUNDED',
] as const;
/** How far back the ordering hours are read for BEST_HOUR. */
export const CAMPAIGN_BEST_HOUR_LOOKBACK_DAYS = 180;
export const CAMPAIGN_BATCH_SIZE = 50;
/** Local hours between which commercial messages may be sent (start inclusive, end exclusive). */
export const CAMPAIGN_SEND_WINDOW = { startHour: 9, endHour: 21 } as const;

export const CampaignSegmentSchema = z
  .object({
    /** At least this many orders placed with the restaurant. */
    minOrders: z.number().int().min(0).max(1000).optional(),
    /** Ordered within the last N days. */
    lastOrderWithinDays: z.number().int().min(1).max(365).optional(),
    /** No order for at least N days (win-back); customers who never ordered count as inactive. */
    inactiveForDays: z.number().int().min(1).max(365).optional(),
    /** Any of these tags (the restaurant's own labels). */
    tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
    firstChannel: z.nativeEnum(OrderChannel).optional(),
  })
  .strict();
export type CampaignSegment = z.infer<typeof CampaignSegmentSchema>;

const CampaignBodySchema = z.string().trim().min(5).max(CAMPAIGN_EMAIL_BODY_MAX);
const CampaignSubjectSchema = z.string().trim().min(2).max(CAMPAIGN_SUBJECT_MAX);

/** The B side of an A/B test: its own text (and subject for email) and the share of the audience that gets it. */
export const CampaignVariantInputSchema = z
  .object({
    body: CampaignBodySchema,
    /** Email only; omitted means variant A's subject. */
    subject: CampaignSubjectSchema.optional(),
    sharePct: z
      .number()
      .int()
      .min(CAMPAIGN_VARIANT_SHARE.min)
      .max(CAMPAIGN_VARIANT_SHARE.max)
      .default(CAMPAIGN_VARIANT_SHARE.default),
    /** Test on part of the audience and send the better text to the rest; sharePct is not used then. */
    autoWinner: z
      .object({
        testPct: z
          .number()
          .int()
          .min(CAMPAIGN_AUTO_WINNER.testPct.min)
          .max(CAMPAIGN_AUTO_WINNER.testPct.max)
          .default(CAMPAIGN_AUTO_WINNER.testPct.default),
        waitHours: z
          .number()
          .int()
          .min(CAMPAIGN_AUTO_WINNER.waitHours.min)
          .max(CAMPAIGN_AUTO_WINNER.waitHours.max)
          .default(CAMPAIGN_AUTO_WINNER.waitHours.default),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CampaignVariantInput = z.infer<typeof CampaignVariantInputSchema>;

export interface CampaignContent {
  channel: CampaignChannel;
  body: string;
  subject?: string | null;
  variant?: { body: string; subject?: string | null } | null;
}

/**
 * Channel rules for the text: SMS and WhatsApp stay short and have no
 * subject; email needs a subject. Returns the first broken rule or null.
 */
export function campaignContentIssue(
  content: CampaignContent,
): 'BODY_TOO_LONG' | 'SUBJECT_REQUIRED' | 'SUBJECT_NOT_ALLOWED' | null {
  if (content.channel === 'EMAIL') {
    return content.subject ? null : 'SUBJECT_REQUIRED';
  }
  if (content.subject || content.variant?.subject) return 'SUBJECT_NOT_ALLOWED';
  if (content.body.length > CAMPAIGN_BODY_MAX) return 'BODY_TOO_LONG';
  if (content.variant && content.variant.body.length > CAMPAIGN_BODY_MAX) return 'BODY_TOO_LONG';
  return null;
}

/** True when the input uses anything that belongs to the campaigns_v2 module. */
export function usesCampaignsV2(input: {
  channel?: CampaignChannel;
  subject?: string | null;
  variant?: unknown;
  sendTimeMode?: CampaignSendTimeMode;
  attributionDays?: number;
}): boolean {
  return (
    input.channel === 'EMAIL' ||
    Boolean(input.subject) ||
    Boolean(input.variant) ||
    input.sendTimeMode === 'BEST_HOUR' ||
    input.attributionDays !== undefined
  );
}

export const CreateCampaignSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    channel: z.enum(CAMPAIGN_CHANNELS),
    body: CampaignBodySchema,
    /** Email only (campaigns v2). */
    subject: CampaignSubjectSchema.optional(),
    /** A/B test (campaigns v2). */
    variant: CampaignVariantInputSchema.optional(),
    sendTimeMode: z.enum(CAMPAIGN_SEND_TIME_MODES).default('FIXED'),
    attributionDays: z.number().int().min(CAMPAIGN_ATTRIBUTION_DAYS.min).max(CAMPAIGN_ATTRIBUTION_DAYS.max).optional(),
    segment: CampaignSegmentSchema.default({}),
    /** A saved segment (segments v2, docs/SEGMENTLER.md); when set it decides the audience instead of `segment`. */
    segmentId: UuidSchema.optional(),
    /** When to send; omitted means it stays a draft until sent. */
    scheduledAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = campaignContentIssue(value);
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body'], message: issue });
  });
export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;

export const UpdateCampaignSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    channel: z.enum(CAMPAIGN_CHANNELS).optional(),
    body: CampaignBodySchema.optional(),
    subject: CampaignSubjectSchema.nullable().optional(),
    variant: CampaignVariantInputSchema.nullable().optional(),
    sendTimeMode: z.enum(CAMPAIGN_SEND_TIME_MODES).optional(),
    attributionDays: z.number().int().min(CAMPAIGN_ATTRIBUTION_DAYS.min).max(CAMPAIGN_ATTRIBUTION_DAYS.max).optional(),
    segment: CampaignSegmentSchema.optional(),
    segmentId: UuidSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'empty update' });
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignSchema>;

/** 32-bit FNV-1a; stable across processes so a recipient's variant never changes on a retry. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Which side of an A/B test a recipient gets: deterministic per campaign and customer. */
export function abVariantFor(campaignId: string, customerId: string, sharePct: number | null): CampaignVariant {
  if (!sharePct) return 'A';
  return fnv1a(`${campaignId}:${customerId}`) % 100 < sharePct ? 'B' : 'A';
}

/** Automatic winner: testPct of the audience tests, half on each text; the rest waits for the winner. */
export function abAutoAssignment(campaignId: string, customerId: string, testPct: number): CampaignRecipientVariant {
  if (fnv1a(`${campaignId}:${customerId}`) % 100 >= testPct) return 'HOLD';
  return fnv1a(`${campaignId}:${customerId}:side`) % 2 === 0 ? 'A' : 'B';
}

export interface AbTestTally {
  sent: number;
  converted: number;
}

/**
 * The text with the higher conversion rate per sent message; A on a tie or when nothing was sent.
 * Compared by cross-multiplication, so no rate is ever rounded.
 */
export function pickAbWinner(a: AbTestTally, b: AbTestTally): CampaignVariant {
  if (b.sent === 0) return 'A';
  if (a.sent === 0) return b.converted > 0 ? 'B' : 'A';
  return b.converted * a.sent > a.converted * b.sent ? 'B' : 'A';
}

/** When the automatic winner may be picked: waitHours after the campaign started. */
export function autoWinnerDecideAt(startedAt: Date, waitHours: number): Date {
  return new Date(startedAt.getTime() + waitHours * 3_600_000);
}

/**
 * When a BEST_HOUR recipient is due: the next top of their preferred local
 * hour, moved inside the send window; now when that hour is the current one.
 */
export function bestHourDueAt(
  now: Date,
  timezone: string,
  preferredHour: number,
  window: { startHour: number; endHour: number } = CAMPAIGN_SEND_WINDOW,
): Date {
  const hour = Math.min(Math.max(preferredHour, window.startHour), window.endHour - 1);
  if (localHour(now, timezone) === hour) return now;
  const topOfHour = new Date(now);
  topOfHour.setUTCMinutes(0, 0, 0);
  for (let i = 1; i <= 26; i += 1) {
    const candidate = new Date(topOfHour.getTime() + i * 3_600_000);
    if (localHour(candidate, timezone) === hour) return candidate;
  }
  return now;
}

/** The hour a customer orders most often (ties go to the earlier hour); null without history. */
export function preferredHourOf(counts: readonly { hour: number; count: number }[]): number | null {
  let best: { hour: number; count: number } | null = null;
  for (const entry of counts) {
    if (!best || entry.count > best.count || (entry.count === best.count && entry.hour < best.hour)) best = entry;
  }
  return best?.hour ?? null;
}

export const SendCampaignSchema = z
  .object({
    /** Omitted means now (subject to the send window). */
    scheduledAt: z.string().datetime().optional(),
  })
  .strict();
export type SendCampaignInput = z.infer<typeof SendCampaignSchema>;

export const CampaignsQuerySchema = PaginationSchema.extend({ status: z.string().optional() }).strict();

/** A segment the restaurant keeps under a name and reuses across campaigns (docs/KAMPANYALAR.md). */
export const SaveSegmentSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    segment: CampaignSegmentSchema,
  })
  .strict();
export type SaveSegmentInput = z.infer<typeof SaveSegmentSchema>;

export const CountAudienceSchema = z.object({ segment: CampaignSegmentSchema.default({}) }).strict();

export interface SavedSegmentDTO {
  id: string;
  name: string;
  segment: CampaignSegment;
  /** Opted-in customers the segment matches right now. */
  audienceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AudienceCountDTO {
  audienceCount: number;
}

export interface CampaignVariantDTO {
  body: string;
  subject: string | null;
  sharePct: number;
  /** Set when the better text is picked automatically after a test. */
  autoWinner: { testPct: number; waitHours: number } | null;
}

export interface CampaignDTO {
  id: string;
  name: string;
  channel: CampaignChannel;
  body: string;
  /** Email subject; null on SMS and WhatsApp. */
  subject: string | null;
  /** The B side of an A/B test, when there is one. */
  variant: CampaignVariantDTO | null;
  sendTimeMode: CampaignSendTimeMode;
  attributionDays: number;
  status: `${CampaignStatus}`;
  segment: CampaignSegment;
  /** The saved segment it targets, when one was chosen. */
  segmentId: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  audienceCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  lastError: string | null;
  /** Send approval (docs/ONAYLAR.md); status NONE where approvals are not used. */
  approval: CampaignApprovalDTO;
  createdAt: string;
}

export interface CampaignRecipientDTO {
  id: string;
  customerId: string;
  fullName: string;
  status: `${CampaignRecipientStatus}`;
  variant: CampaignRecipientVariant;
  /** BEST_HOUR: when this recipient is due. */
  dueAt: string | null;
  convertedAt: string | null;
  errorCode: string | null;
  sentAt: string | null;
}

export interface CampaignDetailDTO extends CampaignDTO {
  recipients: CampaignRecipientDTO[];
}

export interface CampaignPageDTO {
  items: CampaignDTO[];
  total: number;
  page: number;
  pageSize: number;
}

/** What sending would mean right now: who, how many credits, whether the wallet covers it, and when it may go out. */
export interface CampaignPreviewDTO {
  audienceCount: number;
  creditsNeeded: number;
  walletBalance: number;
  enoughCredits: boolean;
  /** The message as the customer will read it, opt-out line included. */
  renderedExample: string;
  /** Variant B as the customer will read it, when there is one. */
  renderedVariantExample: string | null;
  withinSendWindowNow: boolean;
  nextSendWindowStart: string;
  timezone: string;
  /** Whether an approval is needed and which send limit, if any, this campaign would break now. */
  guards: CampaignGuardsDTO;
}

export interface CampaignVariantResultDTO {
  variant: CampaignVariant;
  recipients: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Recipients whose first order within the window was credited to the campaign (cancelled orders excluded). */
  conversions: number;
  /** Items gross of those orders, in the restaurant currency's minor unit. */
  revenueMinor: number;
  /** conversions / sent, in basis points. */
  conversionRateBps: number;
}

export interface CampaignResultsDTO {
  campaignId: string;
  currency: string;
  attributionDays: number;
  variants: CampaignVariantResultDTO[];
  /** The variant with the higher conversion rate once both have been sent; null on a tie or without a test. */
  leader: CampaignVariant | null;
  /** The automatic winner's state, when the test picks it (docs/KAMPANYALAR.md). */
  autoWinner: {
    testPct: number;
    waitHours: number;
    /** When the pick is due; null before the campaign started. */
    decideAt: string | null;
    winner: CampaignVariant | null;
    decidedAt: string | null;
    /** Recipients still waiting for the winner. */
    holding: number;
  } | null;
}

export interface CampaignAudienceDTO {
  total: number;
  optedIn: number;
}

/** Hour of the day (0..23) in the given IANA zone. */
export function localHour(now: Date, timezone: string): number {
  const text = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone }).format(now);
  return Number.parseInt(text, 10);
}

export function isWithinSendWindow(
  now: Date,
  timezone: string,
  window: { startHour: number; endHour: number } = CAMPAIGN_SEND_WINDOW,
): boolean {
  const hour = localHour(now, timezone);
  return hour >= window.startHour && hour < window.endHour;
}

/** The next moment the window is open: now when it is, otherwise the next top of the hour that falls inside it. */
export function nextSendWindowStart(
  now: Date,
  timezone: string,
  window: { startHour: number; endHour: number } = CAMPAIGN_SEND_WINDOW,
): Date {
  if (isWithinSendWindow(now, timezone, window)) return now;
  const topOfHour = new Date(now);
  topOfHour.setUTCMinutes(0, 0, 0);
  for (let i = 1; i <= 48; i += 1) {
    const candidate = new Date(topOfHour.getTime() + i * 3_600_000);
    if (isWithinSendWindow(candidate, timezone, window)) return candidate;
  }
  return topOfHour;
}

/** Commercial message channels a regional consent registry can keep records for. */
export const REGISTRY_CHANNELS = ['SMS', 'CALL', 'EMAIL', 'WHATSAPP'] as const;
export type RegistryChannel = (typeof REGISTRY_CHANNELS)[number];

/**
 * Which channels each country's registry actually covers. Turkey's IYS keeps
 * SMS (MESAJ), calls (ARAMA) and e-mail (EPOSTA); WhatsApp is not an IYS
 * channel yet, so it is never sent there. A channel outside the list is
 * governed by the restaurant's own consent record alone: the customer's
 * explicit opt-in and the one-click opt-out. When the authority adds a
 * channel, it is added here and nothing else changes.
 */
export const CONSENT_REGISTRY_COVERAGE: Readonly<Record<string, readonly RegistryChannel[]>> = {
  TR: ['SMS', 'CALL', 'EMAIL'],
};

export function registryCovers(countryCode: string, channel: RegistryChannel): boolean {
  return CONSENT_REGISTRY_COVERAGE[countryCode.toUpperCase()]?.includes(channel) ?? false;
}

/**
 * Regional consent registry (Turkey: IYS). Before a commercial message goes
 * out on a channel the registry covers (registryCovers), it says which of
 * the opted-in numbers may still be messaged. MOCK approves everything; the
 * real adapter is selected by CONSENT_REGISTRY_PROVIDER and queries the
 * authority. It is never asked about a channel it does not cover.
 */
export interface ConsentRegistryAdapter {
  readonly code: string;
  allowed(countryCode: string, channel: RegistryChannel, phones: readonly string[]): Promise<Set<string>>;
  /**
   * Registers one decision with the authority (IYS expects a brand's
   * consents within days). Only called for covered channels and confirmed
   * decisions; a merchant exemption is registered with the merchant type.
   */
  record(entry: RegistryConsentRecord): Promise<void>;
}

export interface RegistryConsentRecord {
  restaurantId: string;
  countryCode: string;
  channel: RegistryChannel;
  phone: string;
  granted: boolean;
  recipientType: 'INDIVIDUAL' | 'MERCHANT';
  at: Date;
}
