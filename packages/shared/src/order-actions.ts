import type { OrderStatusValue, OrderSummaryDTO } from './delivery';

/**
 * Which transitions a restaurant screen offers for an order, shared by the
 * web order screen and the app (docs/SIPARIS_VE_SEVK.md). The API's state
 * machine (ORDER_TRANSITIONS) stays the authority; this is the friendly
 * subset staff press. Labels are i18n keys in the orders namespace.
 */

export type OrderActionTone = 'error' | 'warn';

export interface OrderActionSpec {
  to: OrderStatusValue;
  labelKey: string;
  tone?: OrderActionTone;
  /** Accepting asks for a preparation time (ORDER_PREP_OPTIONS). */
  needsPrep?: boolean;
  /** Rejecting or cancelling asks for a reason the customer reads. */
  needsReason?: boolean;
}

/** Preparation times offered when accepting, in minutes. */
export const ORDER_PREP_OPTIONS = [10, 15, 20, 25, 30, 40, 50, 60] as const;

export function orderActionsFor(
  order: Pick<OrderSummaryDTO, 'status' | 'fulfillment' | 'activeTrip'>,
): OrderActionSpec[] {
  // An order on a trip moves with the trip (dispatch board or courier), not from the order screen.
  if (order.activeTrip) return [];
  const cancel: OrderActionSpec = {
    to: 'CANCELLED_BY_RESTAURANT',
    labelKey: 'orders.cancel',
    tone: 'error',
    needsReason: true,
  };
  switch (order.status) {
    case 'PENDING_PAYMENT':
      return [cancel];
    case 'PLACED':
      return [
        { to: 'ACCEPTED', labelKey: 'orders.accept', needsPrep: true },
        { to: 'REJECTED', labelKey: 'orders.reject', tone: 'error', needsReason: true },
      ];
    case 'ACCEPTED':
      return [
        { to: 'PREPARING', labelKey: 'orders.markPreparing' },
        { to: 'READY', labelKey: 'orders.markReady' },
        cancel,
      ];
    case 'PREPARING':
      return [{ to: 'READY', labelKey: 'orders.markReady' }, cancel];
    case 'READY':
      if (order.fulfillment === 'PICKUP') return [{ to: 'PICKED_UP', labelKey: 'orders.markPickedUp' }];
      if (order.fulfillment === 'DINE_IN') return [{ to: 'DELIVERED', labelKey: 'orders.markServed' }];
      return [{ to: 'OUT_FOR_DELIVERY', labelKey: 'orders.markOutForDelivery' }, cancel];
    case 'OUT_FOR_DELIVERY':
    case 'ARRIVING':
      return [
        { to: 'DELIVERED', labelKey: 'orders.markDelivered' },
        { to: 'READY', labelKey: 'orders.returnToReady', tone: 'warn' },
      ];
    default:
      return [];
  }
}

/** Orders a screen should sound for: PLACED and not seen before. The caller keeps the seen set. */
export function freshPlacedOrderIds(
  orders: readonly Pick<OrderSummaryDTO, 'id' | 'status'>[],
  seen: ReadonlySet<string>,
): string[] {
  return orders.filter((o) => o.status === 'PLACED' && !seen.has(o.id)).map((o) => o.id);
}
