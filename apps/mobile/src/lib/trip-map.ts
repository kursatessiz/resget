import type { DeliveryStopDTO, DeliveryTripDTO, GeoPoint } from '@resget/shared';
import { regionFor } from './maps';
import type { MapRegion } from './maps';

/**
 * The courier's in-app map (docs/MOBIL.md, "Kurye haritası"): the pickup
 * point, the stops with their sequence and the courier's own position, and
 * a line through the stops still to visit in the order they will be visited.
 * The line is straight between points; turn-by-turn navigation stays in the
 * phone's own maps app (navigationUrl).
 */

export type StopMarkerState = 'done' | 'failed' | 'current' | 'upcoming';

export interface StopMarker {
  stopId: string;
  sequence: number;
  orderShortCode: string;
  point: GeoPoint;
  state: StopMarkerState;
}

export interface TripMapModel {
  pickup: GeoPoint | null;
  courier: GeoPoint | null;
  markers: StopMarker[];
  /** Points to join in order: from the courier (on the road) or the pickup point, through the stops still to visit. */
  route: GeoPoint[];
  /** A region that shows every point, or null when there is nothing to show. */
  region: MapRegion | null;
}

const OPEN_STOP_STATUSES: ReadonlySet<DeliveryStopDTO['status']> = new Set(['PENDING', 'EN_ROUTE', 'ARRIVING']);

function isActive(trip: DeliveryTripDTO): boolean {
  return trip.status === 'PLANNED' || trip.status === 'ASSIGNED' || trip.status === 'IN_PROGRESS';
}

export function tripMapModel(trip: DeliveryTripDTO): TripMapModel {
  const active = isActive(trip);
  const ordered = [...trip.stops].filter((s) => s.status !== 'REMOVED').sort((a, b) => a.sequence - b.sequence);
  const currentId = active ? ordered.find((s) => OPEN_STOP_STATUSES.has(s.status))?.id : undefined;
  const markers: StopMarker[] = [];
  for (const stop of ordered) {
    if (!stop.point) continue;
    const state: StopMarkerState =
      stop.status === 'DELIVERED'
        ? 'done'
        : stop.status === 'FAILED'
          ? 'failed'
          : stop.id === currentId
            ? 'current'
            : 'upcoming';
    markers.push({
      stopId: stop.id,
      sequence: stop.sequence,
      orderShortCode: stop.orderShortCode,
      point: stop.point,
      state,
    });
  }
  const position = trip.courier?.position ?? null;
  const courier = active && position ? { lat: position.lat, lng: position.lng } : null;
  const ahead = markers.filter((m) => m.state === 'current' || m.state === 'upcoming').map((m) => m.point);
  const start = trip.status === 'IN_PROGRESS' ? (courier ?? trip.pickupPoint) : trip.pickupPoint;
  const route = active && ahead.length > 0 ? (start ? [start, ...ahead] : ahead) : [];
  const all = [...(trip.pickupPoint ? [trip.pickupPoint] : []), ...markers.map((m) => m.point)];
  if (courier) all.push(courier);
  return {
    pickup: trip.pickupPoint,
    courier,
    markers,
    route: route.length > 1 ? route : [],
    region: regionFor(all),
  };
}

/** Maps apps the courier can hand a destination to; Apple Maps exists only on iOS. */
export type NavigationApp = 'google' | 'apple' | 'yandex';

export function navigationAppsFor(os: string): NavigationApp[] {
  return os === 'ios' ? ['apple', 'google', 'yandex'] : ['google', 'yandex'];
}

/** The stored choice when it is still offered on this device, else the platform's own maps app. */
export function resolveNavigationApp(stored: string | null, os: string): NavigationApp {
  const offered = navigationAppsFor(os);
  return offered.find((app) => app === stored) ?? offered[0]!;
}

function coordinate(value: number): string {
  return value.toFixed(6);
}

/**
 * Directions to a point in the chosen app. Every link is an https universal
 * link: it opens the installed app, or the app's web page when it is not
 * installed, so no URL scheme has to be declared or probed.
 */
export function navigationUrl(app: NavigationApp, point: GeoPoint): string {
  const lat = coordinate(point.lat);
  const lng = coordinate(point.lng);
  switch (app) {
    case 'apple':
      return `https://maps.apple.com/?daddr=${lat},${lng}`;
    case 'yandex':
      return `https://yandex.com/maps/?rtext=~${lat},${lng}&rtt=auto`;
    default:
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
}
