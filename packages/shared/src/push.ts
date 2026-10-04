import { z } from 'zod';
import type { FulfillmentTypeValue, OrderStatusValue } from './delivery';

/**
 * Push notifications (docs/MESAJLASMA.md, "Push bildirimleri"). A device
 * belongs to a person, not to a restaurant: the same phone receives the
 * customer's order updates, the courier's trip assignments and the staff's
 * new-order alerts, each decided by the person's role in that moment. Push
 * is never metered (CLAUDE.md rule 9) and, when it reaches a device, saves
 * the restaurant the paid SMS or WhatsApp message for the same update.
 */

export const PUSH_PLATFORMS = ['IOS', 'ANDROID'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** Expo push tokens, the only kind the app produces: ExponentPushToken[...] or ExpoPushToken[...]. */
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/;

export function isExpoPushToken(value: string): boolean {
  return EXPO_PUSH_TOKEN_PATTERN.test(value);
}

export const RegisterPushDeviceSchema = z
  .object({
    platform: z.enum(PUSH_PLATFORMS),
    token: z.string().regex(EXPO_PUSH_TOKEN_PATTERN),
    appVersion: z.string().trim().min(1).max(40).optional(),
    /** The device language, so the notification is rendered in it even before the profile locale is set. */
    locale: z
      .string()
      .trim()
      .regex(/^[a-z]{2}(?:-[A-Za-z0-9]{2,8})?$/)
      .optional(),
  })
  .strict();
export type RegisterPushDeviceInput = z.infer<typeof RegisterPushDeviceSchema>;

export interface PushDeviceDTO {
  id: string;
  platform: PushPlatform;
  /** The token's last characters; the full token never leaves the API. */
  tokenTail: string;
  appVersion: string | null;
  locale: string | null;
  lastSeenAt: string;
  createdAt: string;
}

/** Shown in logs and on screens instead of the token: ...k9Qx2L]. */
export function maskPushToken(token: string): string {
  const inner = token.replace(/\]$/, '');
  return `...${inner.slice(-6)}]`;
}

/** Template keys; title and body are the messages `messaging.push.<key>.title` and `.body` in the recipient's language. */
export const PUSH_TEMPLATE_KEYS = [
  'order.accepted',
  'order.readyForPickup',
  'order.outForDelivery',
  'order.arriving',
  'order.completed',
  'order.rejected',
  'order.cancelled',
  'order.refunded',
  'order.partiallyRefunded',
  'order.claimDeclined',
  'trip.assigned',
  'order.placed',
  'order.claimFiled',
  'feedback.lowRating',
] as const;
export type PushTemplateKey = (typeof PUSH_TEMPLATE_KEYS)[number];

/**
 * Which order transitions push the customer. Everything the paid message
 * covers (orderNotificationTemplate) plus two updates that are worth a free
 * push but never a paid message: the courier arriving and the order ending.
 * Dine-in guests are at the table and get nothing.
 */
export function customerPushTemplate(
  fulfillment: FulfillmentTypeValue,
  status: OrderStatusValue,
): PushTemplateKey | null {
  if (fulfillment === 'DINE_IN') return null;
  switch (status) {
    case 'ACCEPTED':
      return 'order.accepted';
    case 'READY':
      return fulfillment === 'PICKUP' ? 'order.readyForPickup' : null;
    case 'OUT_FOR_DELIVERY':
      return fulfillment === 'DELIVERY' ? 'order.outForDelivery' : null;
    case 'ARRIVING':
      return fulfillment === 'DELIVERY' ? 'order.arriving' : null;
    case 'DELIVERED':
    case 'PICKED_UP':
      return 'order.completed';
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

/** What a tap on the notification opens in the app; carried as the notification's data. */
/** `feedback` has no app screen yet: the notification opens the app, the case is handled on the web panel. */
export type PushData =
  { kind: 'tracking'; token: string } | { kind: 'trip'; tripId: string } | { kind: 'orders' } | { kind: 'feedback' };

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The in-app route for a notification's data, or null when the data is not
 * one of ours; the app never navigates on an arbitrary payload.
 */
export function pushRouteFor(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind === 'tracking' && typeof d.token === 'string' && TOKEN_PATTERN.test(d.token)) return `/t/${d.token}`;
  if (d.kind === 'trip' && typeof d.tripId === 'string' && UUID_PATTERN.test(d.tripId))
    return `/(app)/kurye/${d.tripId}`;
  if (d.kind === 'orders') return '/(app)/siparisler';
  return null;
}
