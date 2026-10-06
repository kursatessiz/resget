import { DEFAULT_DISPATCH_SETTINGS } from '@resget/shared';
import type { DeliveryStopDTO, DispatchBoardDTO, GeoPoint, OrderTrackingDTO } from '@resget/shared';
import { MIN_REGION_DELTA, dispatchMapModel, inAppMapAvailable, regionFor, trackingMapModel } from './maps';

const HERE: GeoPoint = { lat: 41.0, lng: 29.0 };
const DOOR: GeoPoint = { lat: 41.01, lng: 29.02 };

const position = (point: GeoPoint) => ({
  ...point,
  headingDeg: null,
  speedMps: null,
  accuracyM: null,
  recordedAt: '2026-10-04T10:00:00.000Z',
});

const tracking = (
  status: OrderTrackingDTO['status'],
  courier: OrderTrackingDTO['courier'],
  destination: GeoPoint | null = DOOR,
): OrderTrackingDTO => ({
  orderId: 'o',
  shortCode: 'ABC123',
  status,
  fulfillment: 'DELIVERY',
  restaurant: { name: 'R', logoUrl: null, themePrimary: '#000000', phone: null },
  items: [],
  placedAt: '2026-10-04T10:00:00.000Z',
  scheduledFor: null,
  deliveryCode: null,
  promisedReadyAt: null,
  estimatedDeliveryAt: null,
  completedAt: null,
  history: [],
  courier,
  destination,
  rating: null,
  canRate: false,
  reviewUrl: null,
  nps: null,
  canAnswerNps: false,
  claim: null,
  canClaim: false,
  tip: null,
  tipOffer: null,
  courierNetwork: null,
});

const stop = (
  id: string,
  sequence: number,
  status: DeliveryStopDTO['status'],
  point: GeoPoint | null,
): DeliveryStopDTO => ({
  id,
  tripId: 't',
  orderId: `o-${id}`,
  orderShortCode: id.toUpperCase(),
  orderStatus: 'READY',
  sequence,
  status,
  point,
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

describe('regionFor', () => {
  it('is null without points and never narrower than the minimum around one point', () => {
    expect(regionFor([])).toBeNull();
    expect(regionFor([HERE])).toEqual({
      latitude: HERE.lat,
      longitude: HERE.lng,
      latitudeDelta: MIN_REGION_DELTA,
      longitudeDelta: MIN_REGION_DELTA,
    });
  });
});

describe('inAppMapAvailable', () => {
  it('shows maps on iOS always and on Android only with a key', () => {
    expect(inAppMapAvailable('ios', false)).toBe(true);
    expect(inAppMapAvailable('android', true)).toBe(true);
    expect(inAppMapAvailable('android', false)).toBe(false);
    expect(inAppMapAvailable('web', true)).toBe(false);
  });
});

describe('trackingMapModel', () => {
  const onTheWay = { firstName: 'Ali', position: position(HERE), distanceMeters: 900, stopsAhead: 0 };

  it('shows the courier and the door while the order is on the road', () => {
    const model = trackingMapModel(tracking('OUT_FOR_DELIVERY', onTheWay));
    expect(model.courier).toEqual(HERE);
    expect(model.destination).toEqual(DOOR);
    expect(model.region).not.toBeNull();
  });

  it('shows nothing before a courier is on the way, and not the door once the order ended', () => {
    expect(trackingMapModel(tracking('PREPARING', null))).toEqual({ courier: null, destination: null, region: null });
    const ended = trackingMapModel(tracking('DELIVERED', onTheWay));
    expect(ended.destination).toBeNull();
  });

  it('keeps the door when the courier has not sent a position yet', () => {
    const model = trackingMapModel(tracking('OUT_FOR_DELIVERY', { ...onTheWay, position: null }));
    expect(model.courier).toBeNull();
    expect(model.destination).toEqual(DOOR);
  });
});

describe('dispatchMapModel', () => {
  it('lists couriers with a position and routable stops of active trips by state', () => {
    const board: DispatchBoardDTO = {
      settings: DEFAULT_DISPATCH_SETTINGS,
      readyOrders: [],
      upcomingOrders: [],
      couriers: [
        { membershipId: 'a', userId: 'a', fullName: 'Ayse', phone: null, position: position(HERE), activeTripId: 't' },
        { membershipId: 'b', userId: 'b', fullName: 'Bora', phone: null, position: null, activeTripId: null },
      ],
      activeTrips: [
        {
          id: 't',
          restaurantId: 'r',
          branchId: 'br',
          status: 'IN_PROGRESS',
          sequenceMode: 'MANUAL',
          pickupPoint: null,
          courier: null,
          stops: [
            stop('s1', 1, 'DELIVERED', DOOR),
            stop('s2', 2, 'EN_ROUTE', { lat: 41.02, lng: 29.03 }),
            stop('s3', 3, 'PENDING', { lat: 41.03, lng: 29.04 }),
            stop('s4', 4, 'PENDING', null),
            stop('s5', 5, 'REMOVED', { lat: 41.04, lng: 29.05 }),
          ],
          plannedDistanceMeters: null,
          plannedDurationSeconds: null,
          createdAt: '2026-10-04T10:00:00.000Z',
          assignedAt: null,
          pickedUpAt: null,
          startedAt: null,
          completedAt: null,
          cancelledAt: null,
          cancelReason: null,
        },
      ],
    };
    const model = dispatchMapModel(board);
    expect(model.couriers.map((c) => c.membershipId)).toEqual(['a']);
    expect(model.stops.map((s) => [s.stopId, s.state])).toEqual([
      ['s1', 'done'],
      ['s2', 'active'],
      ['s3', 'waiting'],
    ]);
    expect(model.region).not.toBeNull();
  });
});
