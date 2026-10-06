import { DeliveryRequestStatus } from './enums';
import type { CourierEventKind } from './courier';
import type { OrderActor, OrderStatusValue } from './delivery';

/**
 * Calling a courier network for one order (docs/KURYE.md, "Kurye çağırma").
 * A request moves forward only; the network's events drive the order along
 * the same status machine as the restaurant's own couriers.
 */

type RequestStatus = `${DeliveryRequestStatus}`;

/** A request in one of these states still has a courier on its way, or about to be. */
export const ACTIVE_DELIVERY_REQUEST_STATUSES: readonly RequestStatus[] = [
  DeliveryRequestStatus.QUOTED,
  DeliveryRequestStatus.REQUESTED,
  DeliveryRequestStatus.ASSIGNED,
  DeliveryRequestStatus.PICKED_UP,
];

/** Order statuses in which a courier may be called: networks expect a call while the food is still cooking. */
export const COURIER_CALLABLE_ORDER_STATUSES: readonly OrderStatusValue[] = ['ACCEPTED', 'PREPARING', 'READY'];

const RANK: Record<RequestStatus, number> = {
  QUOTED: 0,
  REQUESTED: 1,
  ASSIGNED: 2,
  PICKED_UP: 3,
  DELIVERED: 4,
  CANCELLED: 5,
  FAILED: 5,
};

export function isActiveDeliveryRequest(status: RequestStatus): boolean {
  return ACTIVE_DELIVERY_REQUEST_STATUSES.includes(status);
}

/**
 * Where a network event takes the request; null when it changes nothing (a
 * repeat, an event older than the request, or anything after the end).
 */
export function nextDeliveryRequestStatus(current: RequestStatus, kind: CourierEventKind): RequestStatus | null {
  if (!isActiveDeliveryRequest(current)) return null;
  // A cancelled or failed delivery ends the request wherever it stood, except once the food is delivered.
  if (kind === 'CANCELLED' || kind === 'FAILED') return kind;
  return RANK[kind] > RANK[current] ? kind : null;
}

/**
 * The order transitions a network event stands for, in order. A pickup the
 * kitchen did not mark ready first marks it ready (the courier has the food);
 * a cancelled or failed delivery brings an order on the courier leg back to
 * READY so the restaurant can call again or deliver itself.
 */
export function networkOrderSteps(
  status: OrderStatusValue,
  kind: CourierEventKind,
): { to: OrderStatusValue; actor: OrderActor }[] {
  const kitchen = status === 'ACCEPTED' || status === 'PREPARING';
  const toReady = kitchen ? [{ to: 'READY' as const, actor: 'RESTAURANT' as const }] : [];
  const handed = { to: 'HANDED_TO_COURIER' as const, actor: 'COURIER' as const };
  const out = { to: 'OUT_FOR_DELIVERY' as const, actor: 'COURIER' as const };
  const delivered = { to: 'DELIVERED' as const, actor: 'COURIER' as const };
  switch (kind) {
    case 'ASSIGNED':
      return status === 'READY' ? [handed] : [];
    case 'PICKED_UP':
      if (kitchen || status === 'READY') return [...toReady, handed, out];
      return status === 'HANDED_TO_COURIER' ? [out] : [];
    case 'DELIVERED':
      if (kitchen || status === 'READY') return [...toReady, handed, out, delivered];
      if (status === 'HANDED_TO_COURIER') return [out, delivered];
      return status === 'OUT_FOR_DELIVERY' || status === 'ARRIVING' ? [delivered] : [];
    case 'CANCELLED':
    case 'FAILED':
      return status === 'HANDED_TO_COURIER' || status === 'OUT_FOR_DELIVERY' || status === 'ARRIVING'
        ? [{ to: 'READY', actor: 'COURIER' }]
        : [];
  }
}

/** Whether the order screen offers a courier call for this restaurant (docs/KURYE.md). */
export interface CourierNetworkStatusDTO {
  available: boolean;
  providerName: string | null;
}
