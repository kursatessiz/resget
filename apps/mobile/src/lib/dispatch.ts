import type { CourierSummaryDTO, DeliveryTripDTO, DispatchBoardDTO } from '@resget/shared';

/** Width from which the board shows two panes side by side (a tablet in either orientation). */
export const TABLET_MIN_WIDTH = 768;

export function isTabletWidth(width: number): boolean {
  return width >= TABLET_MIN_WIDTH;
}

/** Adds or removes an order from the selection, keeping the order the dispatcher tapped them in (the manual stop order). */
export function toggleSelection(selected: readonly string[], orderId: string, max: number): string[] {
  if (selected.includes(orderId)) return selected.filter((id) => id !== orderId);
  if (selected.length >= max) return [...selected];
  return [...selected, orderId];
}

/** Drops selected orders that are no longer waiting for a trip (another device took them, or they were cancelled). */
export function pruneSelection(selected: readonly string[], board: DispatchBoardDTO): string[] {
  const ready = new Set(board.readyOrders.map((o) => o.id));
  return selected.filter((id) => ready.has(id));
}

export type TripAction = 'assign' | 'optimize' | 'cancel';

/**
 * What the dispatcher may still do with a trip: a courier is chosen or
 * changed and the route reordered only before departure; cancelling is
 * possible until the trip ends. Without dispatch.manage the board is read
 * only. The API enforces the same rules; this only hides dead buttons.
 */
export function tripActions(trip: DeliveryTripDTO, canManage: boolean): TripAction[] {
  if (!canManage) return [];
  const beforeDeparture = trip.status === 'PLANNED' || trip.status === 'ASSIGNED';
  const actions: TripAction[] = [];
  if (beforeDeparture) actions.push('assign');
  if (beforeDeparture && trip.stops.filter((s) => s.point !== null).length > 1) actions.push('optimize');
  if (trip.status !== 'COMPLETED' && trip.status !== 'CANCELLED') actions.push('cancel');
  return actions;
}

/** Couriers free for a new trip first, then the busy ones; alphabetical inside each group. */
export function sortCouriers(couriers: readonly CourierSummaryDTO[]): CourierSummaryDTO[] {
  return [...couriers].sort((a, b) => {
    const busy = Number(a.activeTripId !== null) - Number(b.activeTripId !== null);
    return busy !== 0 ? busy : a.fullName.localeCompare(b.fullName);
  });
}
