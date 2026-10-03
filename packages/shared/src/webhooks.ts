import { z } from 'zod';

/**
 * Outbound webhooks for API access (docs/API_ERISIMI.md, "Webhook'lar"): the
 * platform pushes order changes to a URL the restaurant registered, signed
 * with a secret shown once. Deliveries are retried with backoff and a hook
 * that keeps failing is paused, never silently dropped.
 */

export const WEBHOOK_EVENTS = ['order.updated', 'rating.created'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_SIGNATURE_HEADER = 'x-resget-signature';
export const WEBHOOK_EVENT_HEADER = 'x-resget-event';
export const WEBHOOK_DELIVERY_HEADER = 'x-resget-delivery';

/** Seconds before each retry after a failed attempt; the last failure pauses nothing by itself, the streak does. */
export const WEBHOOK_RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 21600] as const;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_SECONDS.length + 1;
/** Consecutive failed deliveries after which the hook is paused until the restaurant resumes it. */
export const WEBHOOK_DISABLE_AFTER_FAILURES = 20;
/** Seconds a receiver may be behind the timestamp in the signature before it should reject a delivery. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

const WebhookUrlSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((value) => /^https?:\/\//i.test(value), { message: 'http or https URL expected' });

export const CreateWebhookSchema = z
  .object({
    url: WebhookUrlSchema,
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
  })
  .strict();
export type CreateWebhookInput = z.infer<typeof CreateWebhookSchema>;

export const UpdateWebhookSchema = z
  .object({
    url: WebhookUrlSchema.optional(),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'empty update' });
export type UpdateWebhookInput = z.infer<typeof UpdateWebhookSchema>;

export type WebhookDeliveryStatusValue = 'PENDING' | 'SENT' | 'FAILED';

export interface WebhookDTO {
  id: string;
  url: string;
  events: WebhookEvent[];
  isActive: boolean;
  /** Consecutive failed deliveries; reset by a success or by resuming the hook. */
  failureCount: number;
  lastDeliveryAt: string | null;
  lastStatus: number | null;
  createdAt: string;
}

/** The signing secret is shown once, at creation; the platform keeps it encrypted and never returns it again. */
export interface CreatedWebhookDTO extends WebhookDTO {
  secret: string;
}

export interface WebhookDeliveryDTO {
  id: string;
  event: WebhookEvent;
  status: WebhookDeliveryStatusValue;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  sentAt: string | null;
}

/** The body every delivery carries. */
export interface WebhookEnvelope<T = unknown> {
  id: string;
  event: WebhookEvent;
  createdAt: string;
  data: T;
}

/** What is signed: the unix timestamp, a dot, the exact body bytes as sent. */
export function webhookSignedPayload(timestamp: number, body: string): string {
  return `${timestamp}.${body}`;
}

export function formatWebhookSignature(timestamp: number, hexDigest: string): string {
  return `t=${timestamp},v1=${hexDigest}`;
}

/** Splits the header back into its parts; null when it is not ours. */
export function parseWebhookSignature(header: string): { timestamp: number; digest: string } | null {
  const match = /^t=(\d{1,13}),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!match) return null;
  return { timestamp: Number(match[1]), digest: match[2] };
}
