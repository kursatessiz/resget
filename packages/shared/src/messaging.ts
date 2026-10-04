import { z } from 'zod';
import type { MessageChannel, MessageStatus } from './enums';
import type { FulfillmentTypeValue, OrderStatusValue } from './delivery';
import type { CreditChannel } from './plans';
import { UuidSchema } from './validators';

/**
 * Messaging engine (docs/MESAJLASMA.md). One engine sends every message:
 * the channel is a restaurant preference with an SMS fallback, every attempt
 * is a MessageLog row, and a credit leaves the restaurant's wallet only when
 * the provider accepted the message (SENT). OTP and staff invites are
 * platform traffic and never debit a wallet.
 */

export const NOTIFICATION_CHANNELS = ['SMS', 'WHATSAPP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NotificationSettingsSchema = z
  .object({
    /** Transactional order updates to the customer (accepted, on the way, rejected). */
    customerOrderUpdates: z.boolean().default(true),
    channel: z.enum(NOTIFICATION_CHANNELS).default('SMS'),
    /** When the preferred channel refuses the message, send it as SMS instead. */
    fallbackToSms: z.boolean().default(true),
  })
  .strict();
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = NotificationSettingsSchema.parse({});

/** Stored JSON may be null or partial; unknown keys are dropped rather than failing a restaurant. */
export function notificationSettingsFrom(raw: unknown): NotificationSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_NOTIFICATION_SETTINGS;
  const known = Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(([key]) => key in DEFAULT_NOTIFICATION_SETTINGS),
  );
  const parsed = NotificationSettingsSchema.safeParse(known);
  return parsed.success ? parsed.data : DEFAULT_NOTIFICATION_SETTINGS;
}

/** Template keys; the text of each is the message `messaging.template.<key>` in the recipient's language. */
export const MESSAGE_TEMPLATE_KEYS = [
  'otp.code',
  'staff.invite',
  'order.accepted',
  'order.readyForPickup',
  'order.outForDelivery',
  'order.rejected',
  'order.cancelled',
  'order.refunded',
  'order.partiallyRefunded',
  'order.claimDeclined',
  'invoice.issued',
  'invoice.overdue',
  'order.acceptOverdue',
  'campaign.body',
  'listing.approved',
  'listing.declined',
] as const;
export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number];

/**
 * Which order transitions message the customer. Dine-in guests are at the
 * table and get nothing; a pickup order announces when it is ready; delivery
 * orders announce departure with the live tracking link. DELIVERED is not
 * messaged: the tracking page already shows it and a credit would be spent
 * on news the customer has in hand.
 */
export function orderNotificationTemplate(
  fulfillment: FulfillmentTypeValue,
  status: OrderStatusValue,
): MessageTemplateKey | null {
  if (fulfillment === 'DINE_IN') return null;
  switch (status) {
    case 'ACCEPTED':
      return 'order.accepted';
    case 'READY':
      return fulfillment === 'PICKUP' ? 'order.readyForPickup' : null;
    case 'OUT_FOR_DELIVERY':
      return fulfillment === 'DELIVERY' ? 'order.outForDelivery' : null;
    case 'REJECTED':
      return 'order.rejected';
    case 'CANCELLED_BY_RESTAURANT':
      return 'order.cancelled';
    case 'REFUNDED':
      return 'order.refunded';
    default:
      return null;
  }
}

export interface MessageWalletDTO {
  channel: CreditChannel;
  balance: number;
}

export interface MessageCreditPackageDTO {
  code: string;
  channel: CreditChannel;
  credits: number;
  priceMinor: number;
  currency: string;
}

export interface MessageLogDTO {
  id: string;
  channel: `${MessageChannel}`;
  toMasked: string;
  templateKey: string;
  status: `${MessageStatus}`;
  provider: string;
  creditsCharged: number;
  errorCode: string | null;
  createdAt: string;
}

export interface MessagingOverviewDTO {
  wallets: MessageWalletDTO[];
  /** Packages in the restaurant's currency. */
  packages: MessageCreditPackageDTO[];
  recent: MessageLogDTO[];
  settings: NotificationSettings;
}

export const PurchaseCreditsSchema = z
  .object({
    packageCode: z.string().regex(/^[a-z0-9-]{3,40}$/),
    /** The buyer's saved card (/me/payment-methods); the platform never sees a card number. */
    paymentMethodId: UuidSchema,
    /** Where a 3-D Secure challenge returns to. */
    returnUrl: z.string().url(),
  })
  .strict();
export type PurchaseCreditsInput = z.infer<typeof PurchaseCreditsSchema>;

export interface PurchaseCreditsResultDTO {
  status: 'CAPTURED' | 'REQUIRES_3DS' | 'FAILED';
  redirectUrl: string | null;
  failureCode: string | null;
  wallets: MessageWalletDTO[];
}
