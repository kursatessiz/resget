import type { CourierSummaryDTO, DeliveryStopDTO, DeliveryTripDTO, DispatchBoardDTO } from '@resget/shared';
import { isTabletWidth, pruneSelection, sortCouriers, toggleSelection, tripActions } from './dispatch';

const stop = (id: string, point: boolean): DeliveryStopDTO => ({
  id,
  tripId: 't',
  orderId: `o-${id}`,
  orderShortCode: id.toUpperCase(),
  orderStatus: 'READY',
  sequence: 1,
  status: 'PENDING',
  point: point ? { lat: 41, lng: 29 } : null,
  address: null,
  distanceMeters: null,
  etaAt: null,
  arrivedAt: null,
  deliveredAt: null,
  failedAt: null,
  failureReason: null,
  proof: null,
  codeLocked: false,
});

const trip = (status: DeliveryTripDTO['status'], stops: DeliveryStopDTO[]): DeliveryTripDTO => ({
  id: 't',
  restaurantId: 'r',
  branchId: 'b',
  status,
  sequenceMode: 'MANUAL',
  pickupPoint: null,
  courier: null,
  stops,
  plannedDistanceMeters: null,
  plannedDurationSeconds: null,
  createdAt: '2026-10-04T10:00:00.000Z',
  assignedAt: null,
  pickedUpAt: null,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
});

const courier = (name: string, busy: boolean): CourierSummaryDTO => ({
  membershipId: name,
  userId: name,
  fullName: name,
  phone: null,
  position: null,
  activeTripId: busy ? 'trip' : null,
});

describe('mobile dispatch board logic', () => {
  it('switches to two panes from tablet width', () => {
    expect(isTabletWidth(390)).toBe(false);
    expect(isTabletWidth(768)).toBe(true);
  });

  it('keeps the tap order, toggles off and respects the trip size limit', () => {
    let selected = toggleSelection([], 'a', 2);
    selected = toggleSelection(selected, 'b', 2);
    expect(selected).toEqual(['a', 'b']);
    expect(toggleSelection(selected, 'c', 2)).toEqual(['a', 'b']);
    expect(toggleSelection(selected, 'a', 2)).toEqual(['b']);
  });

  it('forgets selected orders that left the ready list', () => {
    const board = { readyOrders: [{ id: 'b' }] } as unknown as DispatchBoardDTO;
    expect(pruneSelection(['a', 'b'], board)).toEqual(['b']);
  });

  it('offers only the actions the trip still allows', () => {
    expect(tripActions(trip('PLANNED', [stop('a', true), stop('b', true)]), true)).toEqual([
      'assign',
      'optimize',
      'cancel',
    ]);
    expect(tripActions(trip('ASSIGNED', [stop('a', true), stop('b', false)]), true)).toEqual(['assign', 'cancel']);
    expect(tripActions(trip('IN_PROGRESS', [stop('a', true), stop('b', true)]), true)).toEqual(['cancel']);
    expect(tripActions(trip('PLANNED', [stop('a', true)]), false)).toEqual([]);
  });

  it('lists free couriers first', () => {
    expect(
      sortCouriers([courier('Zeki', false), courier('Ayse', true), courier('Can', false)]).map((c) => c.fullName),
    ).toEqual(['Can', 'Zeki', 'Ayse']);
  });
});
