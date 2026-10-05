import type { DeliveryStopDTO, DeliveryTripDTO, GeoPoint } from '@resget/shared';
import { navigationAppsFor, navigationUrl, resolveNavigationApp, tripMapModel } from './trip-map';

const PICKUP: GeoPoint = { lat: 41.0, lng: 29.0 };

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

const trip = (
  status: DeliveryTripDTO['status'],
  stops: DeliveryStopDTO[],
  position: GeoPoint | null = null,
  pickupPoint: GeoPoint | null = PICKUP,
): DeliveryTripDTO => ({
  id: 't',
  restaurantId: 'r',
  branchId: 'b',
  status,
  sequenceMode: 'MANUAL',
  pickupPoint,
  courier: {
    membershipId: 'm',
    userId: 'u',
    fullName: 'Kurye',
    phone: null,
    position: position
      ? { ...position, headingDeg: null, speedMps: null, accuracyM: null, recordedAt: '2026-10-04T10:00:00.000Z' }
      : null,
    activeTripId: 't',
  },
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

describe('tripMapModel', () => {
  const a = { lat: 41.01, lng: 29.01 };
  const b = { lat: 41.02, lng: 29.03 };
  const c = { lat: 41.03, lng: 29.02 };

  it('orders markers by sequence, skips stops without coordinates and routes from the pickup point before departure', () => {
    const model = tripMapModel(
      trip('ASSIGNED', [stop('b', 2, 'PENDING', b), stop('x', 3, 'PENDING', null), stop('a', 1, 'PENDING', a)]),
    );
    expect(model.markers.map((m) => [m.stopId, m.state])).toEqual([
      ['a', 'current'],
      ['b', 'upcoming'],
    ]);
    expect(model.route).toEqual([PICKUP, a, b]);
    expect(model.pickup).toEqual(PICKUP);
    expect(model.courier).toBeNull();
  });

  it('starts the line at the courier on the road and leaves visited stops out of it', () => {
    const here = { lat: 41.015, lng: 29.02 };
    const model = tripMapModel(
      trip('IN_PROGRESS', [stop('a', 1, 'DELIVERED', a), stop('b', 2, 'FAILED', b), stop('c', 3, 'ARRIVING', c)], here),
    );
    expect(model.markers.map((m) => m.state)).toEqual(['done', 'failed', 'current']);
    expect(model.route).toEqual([here, c]);
    expect(model.courier).toEqual(here);
  });

  it('falls back to the pickup point when no position has arrived yet, and to the stops alone without one', () => {
    expect(tripMapModel(trip('IN_PROGRESS', [stop('a', 1, 'PENDING', a)])).route).toEqual([PICKUP, a]);
    expect(tripMapModel(trip('ASSIGNED', [stop('a', 1, 'PENDING', a)], null, null)).route).toEqual([]);
    expect(
      tripMapModel(trip('ASSIGNED', [stop('a', 1, 'PENDING', a), stop('b', 2, 'PENDING', b)], null, null)).route,
    ).toEqual([a, b]);
  });

  it('draws no line and no courier once the trip is over', () => {
    const model = tripMapModel(trip('COMPLETED', [stop('a', 1, 'DELIVERED', a)], { lat: 41.1, lng: 29.1 }));
    expect(model.route).toEqual([]);
    expect(model.courier).toBeNull();
    expect(model.markers[0]?.state).toBe('done');
  });

  it('fits every point in the region', () => {
    const model = tripMapModel(trip('ASSIGNED', [stop('a', 1, 'PENDING', a), stop('b', 2, 'PENDING', b)]));
    const region = model.region!;
    for (const p of [PICKUP, a, b]) {
      expect(Math.abs(p.lat - region.latitude)).toBeLessThanOrEqual(region.latitudeDelta / 2);
      expect(Math.abs(p.lng - region.longitude)).toBeLessThanOrEqual(region.longitudeDelta / 2);
    }
  });
});

describe('navigation handoff', () => {
  const point = { lat: 41.0082376, lng: 28.9783589 };

  it('offers Apple Maps only on iOS and keeps a stored choice that is still offered', () => {
    expect(navigationAppsFor('ios')).toEqual(['apple', 'google', 'yandex']);
    expect(navigationAppsFor('android')).toEqual(['google', 'yandex']);
    expect(resolveNavigationApp(null, 'ios')).toBe('apple');
    expect(resolveNavigationApp(null, 'android')).toBe('google');
    expect(resolveNavigationApp('yandex', 'android')).toBe('yandex');
    expect(resolveNavigationApp('apple', 'android')).toBe('google');
    expect(resolveNavigationApp('unknown', 'ios')).toBe('apple');
  });

  it('builds https directions links with six decimals', () => {
    expect(navigationUrl('google', point)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=41.008238,28.978359',
    );
    expect(navigationUrl('apple', point)).toBe('https://maps.apple.com/?daddr=41.008238,28.978359');
    expect(navigationUrl('yandex', point)).toBe('https://yandex.com/maps/?rtext=~41.008238,28.978359&rtt=auto');
  });
});
