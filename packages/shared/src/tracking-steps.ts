import type { FulfillmentTypeValue, OrderStatusValue } from './delivery';

/**
 * The customer's view of an order's progress (docs/SIPARIS_VE_SEVK.md,
 * docs/VITRIN.md): one short ladder per fulfillment type, shared by the web
 * tracking page and the mobile app so both draw the same steps.
 */
export type TrackingStep =
  'placed' | 'accepted' | 'preparing' | 'ready' | 'onTheWay' | 'delivered' | 'pickedUp' | 'served';

export const TRACKING_STEPS: Record<FulfillmentTypeValue, readonly TrackingStep[]> = {
  DELIVERY: ['placed', 'accepted', 'preparing', 'ready', 'onTheWay', 'delivered'],
  PICKUP: ['placed', 'accepted', 'preparing', 'ready', 'pickedUp'],
  DINE_IN: ['placed', 'accepted', 'preparing', 'served'],
};

/** Index of the step a status has reached on the ladder of its fulfillment type; -1 for a cancelled or rejected order. */
export function trackingStepIndex(status: OrderStatusValue, fulfillment: FulfillmentTypeValue): number {
  const steps = TRACKING_STEPS[fulfillment];
  switch (status) {
    case 'PENDING_PAYMENT':
    case 'PLACED':
      return 0;
    case 'ACCEPTED':
      return 1;
    case 'PREPARING':
      return 2;
    case 'READY':
      return fulfillment === 'DINE_IN' ? 2 : 3;
    case 'HANDED_TO_COURIER':
    case 'OUT_FOR_DELIVERY':
    case 'ARRIVING':
      return 4;
    case 'DELIVERED':
    case 'PICKED_UP':
      return steps.length - 1;
    default:
      return -1;
  }
}

/** Statuses after which the order no longer changes; live updates stop here. */
export const TRACKING_ENDED_STATUSES: ReadonlySet<OrderStatusValue> = new Set<OrderStatusValue>([
  'DELIVERED',
  'PICKED_UP',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_RESTAURANT',
  'REJECTED',
  'REFUNDED',
]);

export function isTrackingEnded(status: OrderStatusValue): boolean {
  return TRACKING_ENDED_STATUSES.has(status);
}

/** The i18n key of the sentence shown for a status; a ready delivery order waits for a courier, not for the customer. */
export function trackingStatusMessageKey(status: OrderStatusValue, fulfillment: FulfillmentTypeValue): string {
  return status === 'READY' && fulfillment === 'DELIVERY'
    ? 'tracking.status.READY.DELIVERY'
    : `tracking.status.${status}`;
}

/**
 * The tracking token inside a tracking link: the web address `/t/<token>`,
 * the app scheme `resget://t/<token>` or a bare path. Null for anything else,
 * so a deep link never opens a screen with an arbitrary value.
 */
export function trackingTokenFromLink(link: string): string | null {
  const match = /(?:^|\/)t\/([A-Za-z0-9_-]{8,128})(?:[/?#]|$)/.exec(link.trim());
  return match?.[1] ?? null;
}
