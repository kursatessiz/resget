import { z } from 'zod';
import { OrderChannel } from './enums';
import type { CampaignRecipientStatus, CampaignStatus } from './enums';
import { NOTIFICATION_CHANNELS } from './messaging';
import type { NotificationChannel } from './messaging';
import { PaginationSchema } from './validators';

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

export const CreateCampaignSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    channel: z.enum(NOTIFICATION_CHANNELS),
    body: z.string().trim().min(5).max(CAMPAIGN_BODY_MAX),
    segment: CampaignSegmentSchema.default({}),
    /** When to send; omitted means it stays a draft until sent. */
    scheduledAt: z.string().datetime().optional(),
  })
  .strict();
export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;

export const UpdateCampaignSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    channel: z.enum(NOTIFICATION_CHANNELS).optional(),
    body: z.string().trim().min(5).max(CAMPAIGN_BODY_MAX).optional(),
    segment: CampaignSegmentSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'empty update' });
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignSchema>;

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

export interface CampaignDTO {
  id: string;
  name: string;
  channel: NotificationChannel;
  body: string;
  status: `${CampaignStatus}`;
  segment: CampaignSegment;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  audienceCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  lastError: string | null;
  createdAt: string;
}

export interface CampaignRecipientDTO {
  id: string;
  customerId: string;
  fullName: string;
  status: `${CampaignRecipientStatus}`;
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
  withinSendWindowNow: boolean;
  nextSendWindowStart: string;
  timezone: string;
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
