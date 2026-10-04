import type { DispatchBoardDTO, GeoPoint, OrderTrackingDTO } from '@resget/shared';
import { isTrackingEnded } from '@resget/shared';

/**
 * Map models for the app's screens (docs/MOBIL.md, "Haritalar"): what each
 * map shows is decided here, in pure functions, and drawn by
 * components/map-panel.tsx. The courier's trip map lives in trip-map.ts.
 */

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** A small area around a single point (about a kilometre across). */
export const MIN_REGION_DELTA = 0.01;
/** Room around the outermost points so markers are not cut at the edge. */
export const REGION_PADDING = 1.4;

/** The region that fits every point with some padding; never narrower than MIN_REGION_DELTA. */
export function regionFor(points: readonly GeoPoint[]): MapRegion | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * REGION_PADDING, MIN_REGION_DELTA),
    longitudeDelta: Math.max((maxLng - minLng) * REGION_PADDING, MIN_REGION_DELTA),
  };
}

/** Apple Maps draws on iOS without a key; Google Maps on Android needs the key the build was given. */
export function inAppMapAvailable(os: string, androidKeyConfigured: boolean): boolean {
  return os === 'ios' || (os === 'android' && androidKeyConfigured);
}

export interface TrackingMapModel {
  courier: GeoPoint | null;
  destination: GeoPoint | null;
  region: MapRegion | null;
}

/**
 * The customer's map, the same rule as the web tracking page: the courier
 * while a position is known, and the door only while the order is still on
 * the road with a courier. Nothing of any other customer.
 */
export function trackingMapModel(tracking: OrderTrackingDTO): TrackingMapModel {
  const position = tracking.courier?.position ?? null;
  const courier = position ? { lat: position.lat, lng: position.lng } : null;
  const destination =
    tracking.destination && tracking.courier && !isTrackingEnded(tracking.status) ? tracking.destination : null;
  const points = [courier, destination].filter((p): p is GeoPoint => p !== null);
  return { courier, destination, region: regionFor(points) };
}

export type DispatchStopState = 'waiting' | 'active' | 'done';

export interface DispatchMapModel {
  couriers: { membershipId: string; fullName: string; point: GeoPoint }[];
  stops: { stopId: string; sequence: number; orderShortCode: string; point: GeoPoint; state: DispatchStopState }[];
  region: MapRegion | null;
}

/** The dispatch map, as on the web board: couriers sharing a position and every routable stop of an active trip. */
export function dispatchMapModel(board: DispatchBoardDTO): DispatchMapModel {
  const couriers = board.couriers.flatMap((c) =>
    c.position
      ? [{ membershipId: c.membershipId, fullName: c.fullName, point: { lat: c.position.lat, lng: c.position.lng } }]
      : [],
  );
  const stops = board.activeTrips.flatMap((trip) =>
    trip.stops.flatMap((stop) => {
      if (!stop.point || stop.status === 'REMOVED') return [];
      const state: DispatchStopState =
        stop.status === 'DELIVERED' || stop.status === 'FAILED'
          ? 'done'
          : stop.status === 'ARRIVING' || stop.status === 'EN_ROUTE'
            ? 'active'
            : 'waiting';
      return [
        { stopId: stop.id, sequence: stop.sequence, orderShortCode: stop.orderShortCode, point: stop.point, state },
      ];
    }),
  );
  return { couriers, stops, region: regionFor([...couriers.map((c) => c.point), ...stops.map((s) => s.point)]) };
}
