import { z } from 'zod';
import type { OrderRatingDTO } from './ratings';
import {
  DeliveryStopStatus,
  DeliveryTripStatus,
  FulfillmentType,
  OrderChannel,
  OrderStatus,
  StopSequenceMode,
} from './enums';
import { GeoPointSchema } from './courier';
import type { GeoPoint } from './courier';
import { MinorAmountSchema } from './money';
import { OrderPaymentIntentSchema } from './meal-cards';
import type { OrderPaymentDTO } from './meal-cards';
import type { OrderRefundDTO } from './refunds';
import { PhoneSchema, UuidSchema } from './validators';

/**
 * Order lifecycle, dispatch of the restaurant's own couriers and live
 * tracking (docs/SIPARIS_VE_SEVK.md).
 *
 * Shape of the flow, the way the large delivery platforms run it:
 *   customer places -> restaurant accepts with a preparation time ->
 *   preparing -> ready -> courier picks up (one trip, one or more orders) ->
 *   on the way, stop by stop -> arriving (geofence) -> delivered.
 * Every step is one status transition recorded in order_status_history and
 * pushed to the restaurant, the courier and the customer as a realtime event.
 */

// -- Order state machine --------------------------------------------------------

export type OrderStatusValue = `${OrderStatus}`;
export type FulfillmentTypeValue = `${FulfillmentType}`;
export type OrderChannelValue = `${OrderChannel}`;
export type DeliveryTripStatusValue = `${DeliveryTripStatus}`;
export type DeliveryStopStatusValue = `${DeliveryStopStatus}`;
export type StopSequenceModeValue = `${StopSequenceMode}`;

/** Zod enums over the string values, so parsed input is typed as the string union, not the TS enum. */
const values = <T extends Record<string, string>>(e: T) =>
  Object.values(e) as unknown as [`${T[keyof T]}`, ...`${T[keyof T]}`[]];
export const OrderStatusValueSchema = z.enum(values(OrderStatus));
export const FulfillmentTypeValueSchema = z.enum(values(FulfillmentType));
export const OrderChannelValueSchema = z.enum(values(OrderChannel));
export const DeliveryTripStatusValueSchema = z.enum(values(DeliveryTripStatus));
export const StopSequenceModeValueSchema = z.enum(values(StopSequenceMode));

/** Who may trigger a transition. SYSTEM is the platform itself (payment capture, geofence, timeouts). */
export type OrderActor = 'RESTAURANT' | 'COURIER' | 'CUSTOMER' | 'SYSTEM';

type TransitionTable = Partial<Record<OrderStatusValue, Partial<Record<OrderStatusValue, readonly OrderActor[]>>>>;

const KITCHEN_TRANSITIONS: TransitionTable = {
  PENDING_PAYMENT: { PLACED: ['SYSTEM', 'CUSTOMER'], CANCELLED_BY_CUSTOMER: ['CUSTOMER', 'SYSTEM'] },
  PLACED: {
    ACCEPTED: ['RESTAURANT'],
    REJECTED: ['RESTAURANT'],
    CANCELLED_BY_CUSTOMER: ['CUSTOMER'],
    CANCELLED_BY_RESTAURANT: ['RESTAURANT'],
  },
  ACCEPTED: {
    PREPARING: ['RESTAURANT'],
    READY: ['RESTAURANT'],
    CANCELLED_BY_CUSTOMER: ['CUSTOMER'],
    CANCELLED_BY_RESTAURANT: ['RESTAURANT'],
  },
  PREPARING: { READY: ['RESTAURANT'], CANCELLED_BY_RESTAURANT: ['RESTAURANT'] },
  DELIVERED: { REFUNDED: ['RESTAURANT', 'SYSTEM'] },
  PICKED_UP: { REFUNDED: ['RESTAURANT', 'SYSTEM'] },
  REJECTED: { REFUNDED: ['RESTAURANT', 'SYSTEM'] },
  CANCELLED_BY_CUSTOMER: { REFUNDED: ['RESTAURANT', 'SYSTEM'] },
  CANCELLED_BY_RESTAURANT: { REFUNDED: ['RESTAURANT', 'SYSTEM'] },
};

/**
 * Allowed transitions per fulfillment type. A delivery order has a courier
 * leg; a pickup order ends when the customer collects it; a dine-in order
 * ends when it is served (DELIVERED). "Back to READY" is how a failed
 * delivery or a cancelled trip returns the order to the restaurant.
 */
export const ORDER_TRANSITIONS: Readonly<Record<FulfillmentTypeValue, TransitionTable>> = {
  DELIVERY: {
    ...KITCHEN_TRANSITIONS,
    READY: {
      HANDED_TO_COURIER: ['COURIER', 'RESTAURANT'],
      OUT_FOR_DELIVERY: ['RESTAURANT'],
      CANCELLED_BY_RESTAURANT: ['RESTAURANT'],
    },
    HANDED_TO_COURIER: {
      OUT_FOR_DELIVERY: ['COURIER', 'RESTAURANT'],
      READY: ['COURIER', 'RESTAURANT'],
      CANCELLED_BY_RESTAURANT: ['RESTAURANT'],
    },
    OUT_FOR_DELIVERY: {
      ARRIVING: ['COURIER', 'SYSTEM'],
      DELIVERED: ['COURIER', 'RESTAURANT'],
      READY: ['COURIER', 'RESTAURANT'],
    },
    ARRIVING: {
      DELIVERED: ['COURIER', 'RESTAURANT'],
      READY: ['COURIER', 'RESTAURANT'],
    },
  },
  PICKUP: {
    ...KITCHEN_TRANSITIONS,
    READY: { PICKED_UP: ['RESTAURANT'], CANCELLED_BY_RESTAURANT: ['RESTAURANT'] },
  },
  DINE_IN: {
    ...KITCHEN_TRANSITIONS,
    READY: { DELIVERED: ['RESTAURANT'], CANCELLED_BY_RESTAURANT: ['RESTAURANT'] },
  },
};

export const TERMINAL_ORDER_STATUSES: readonly OrderStatusValue[] = [
  'DELIVERED',
  'PICKED_UP',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_RESTAURANT',
  'REJECTED',
  'REFUNDED',
];

/** Statuses of the courier leg; while an order sits in an active trip only the trip may set them. */
export const COURIER_LEG_STATUSES: readonly OrderStatusValue[] = [
  'HANDED_TO_COURIER',
  'OUT_FOR_DELIVERY',
  'ARRIVING',
  'DELIVERED',
];

export function canTransitionOrder(
  fulfillment: FulfillmentTypeValue,
  from: OrderStatusValue,
  to: OrderStatusValue,
  actor: OrderActor,
): boolean {
  const actors = ORDER_TRANSITIONS[fulfillment][from]?.[to];
  return Boolean(actors && actors.includes(actor));
}

export function allowedOrderTransitions(
  fulfillment: FulfillmentTypeValue,
  from: OrderStatusValue,
  actor: OrderActor,
): OrderStatusValue[] {
  const row = ORDER_TRANSITIONS[fulfillment][from] ?? {};
  return (Object.keys(row) as OrderStatusValue[]).filter((to) => row[to]?.includes(actor));
}

export function isTerminalOrderStatus(status: OrderStatusValue): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

/** Which timestamp column of the order a transition stamps, when any. */
export function orderTimestampFor(
  to: OrderStatusValue,
): 'acceptedAt' | 'readyAt' | 'completedAt' | 'cancelledAt' | null {
  switch (to) {
    case 'ACCEPTED':
      return 'acceptedAt';
    case 'READY':
      return 'readyAt';
    case 'DELIVERED':
    case 'PICKED_UP':
      return 'completedAt';
    case 'CANCELLED_BY_CUSTOMER':
    case 'CANCELLED_BY_RESTAURANT':
    case 'REJECTED':
      return 'cancelledAt';
    default:
      return null;
  }
}

// -- Geography -------------------------------------------------------------------

const EARTH_RADIUS_METERS = 6_371_008.8;

/** Great-circle distance in metres between two points. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

// -- Dispatch settings (tenant data, never constants in the flow) --------------

/**
 * Per-restaurant dispatch tuning. Defaults match an urban moped courier;
 * the restaurant adjusts them, the platform never hardcodes them elsewhere.
 */
export const DispatchSettingsSchema = z
  .object({
    /** Average door-to-door courier speed used for ETAs when no road routing provider is configured. */
    avgSpeedKmh: z.number().min(3).max(90).default(22),
    /** Straight-line to road distance multiplier for the haversine routing fallback. */
    detourFactor: z.number().min(1).max(2.5).default(1.35),
    /** Hand-over time at each stop (find the door, collect cash, take the photo). */
    stopServiceMinutes: z.number().min(0).max(30).default(3),
    /** Within this distance of the customer the stop becomes ARRIVING automatically. */
    arrivalRadiusMeters: z.number().int().min(30).max(2000).default(150),
    /** Upper bound the dispatch screen enforces when batching orders into one trip. */
    maxStopsPerTrip: z.number().int().min(1).max(12).default(6),
    /** Courier positions are fanned out to clients at most this often. */
    locationBroadcastSeconds: z.number().int().min(1).max(60).default(4),
    /** Preparation time offered by default when the restaurant accepts an order. */
    defaultPrepMinutes: z.number().int().min(1).max(180).default(20),
    /** Minutes a new order may wait for acceptance before the screen alarms and the owner is messaged. */
    acceptTimeoutMinutes: z.number().int().min(1).max(60).default(10),
  })
  .strict();
export type DispatchSettings = z.infer<typeof DispatchSettingsSchema>;
export const DEFAULT_DISPATCH_SETTINGS: DispatchSettings = DispatchSettingsSchema.parse({});

/** When a PLACED order must be accepted by (docs/SIPARIS_VE_SEVK.md, kabul zaman asimi). */
export function acceptDeadlineFor(placedAt: Date, settings: Pick<DispatchSettings, 'acceptTimeoutMinutes'>): Date {
  return new Date(placedAt.getTime() + settings.acceptTimeoutMinutes * 60_000);
}

/** Stored JSON may be null or partial; unknown keys are dropped rather than failing a restaurant. */
export function dispatchSettingsFrom(raw: unknown): DispatchSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_DISPATCH_SETTINGS;
  const known = Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(([key]) => key in DEFAULT_DISPATCH_SETTINGS),
  );
  const parsed = DispatchSettingsSchema.safeParse(known);
  return parsed.success ? parsed.data : DEFAULT_DISPATCH_SETTINGS;
}

// -- Routing -----------------------------------------------------------------------

export interface RouteLeg {
  distanceMeters: number;
  durationSeconds: number;
}

/**
 * Road routing behind an adapter, like every other provider. The default
 * implementation is straight-line distance times a detour factor; a real
 * road engine (OSRM, Mapbox, Google) is a registration, not a code path.
 */
export interface RoutingProviderAdapter {
  readonly code: string;
  /** Legs between consecutive points: result[i] is the leg from points[i] to points[i + 1]. */
  legs(points: GeoPoint[]): Promise<RouteLeg[]>;
  /**
   * Road distance in metres between every pair of points (result[i][j] from
   * points[i] to points[j]) for the stop optimiser; absent when the engine
   * has no matrix service, the optimiser then uses straight lines.
   */
  matrix?(points: GeoPoint[]): Promise<number[][]>;
}

export function haversineLegs(points: GeoPoint[], settings: DispatchSettings): RouteLeg[] {
  const metersPerSecond = (settings.avgSpeedKmh * 1000) / 3600;
  const legs: RouteLeg[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const distanceMeters = Math.round(haversineMeters(points[i], points[i + 1]) * settings.detourFactor);
    legs.push({ distanceMeters, durationSeconds: Math.round(distanceMeters / metersPerSecond) });
  }
  return legs;
}

export function createHaversineRouting(settings: DispatchSettings): RoutingProviderAdapter {
  return { code: 'HAVERSINE', legs: async (points) => haversineLegs(points, settings) };
}

// -- Stop ordering ---------------------------------------------------------------

export interface RoutableStop {
  id: string;
  point: GeoPoint | null;
}

/**
 * Orders the stops of a trip from the restaurant: nearest neighbour first,
 * then 2-opt until no swap shortens the open path. Exact for the trip sizes
 * dispatch allows (maxStopsPerTrip); stops without coordinates cannot be
 * routed and are appended in their given order. Deterministic: ties keep
 * the earlier stop first, so the same input always yields the same route.
 * Distances are straight lines unless a road matrix over [origin, ...routable
 * stops] is given (a routing engine's table service); a matrix of the wrong
 * shape is ignored rather than trusted.
 */
export function optimizeStopOrder<T extends RoutableStop>(
  origin: GeoPoint,
  stops: readonly T[],
  roadMatrix?: readonly (readonly number[])[],
): T[] {
  const routable = stops.filter((s): s is T & { point: GeoPoint } => s.point !== null);
  const unroutable = stops.filter((s) => s.point === null);
  if (routable.length <= 1) return [...routable, ...unroutable];

  const points: GeoPoint[] = [origin, ...routable.map((s) => s.point)];
  const n = points.length;
  const usable =
    roadMatrix !== undefined &&
    roadMatrix.length === n &&
    roadMatrix.every((row) => row.length === n && row.every((v) => Number.isFinite(v) && v >= 0));
  const dist: number[][] = usable
    ? roadMatrix.map((row) => [...row])
    : points.map((a) => points.map((b) => haversineMeters(a, b)));

  // Nearest neighbour from the origin (index 0).
  const remaining = new Set<number>();
  for (let i = 1; i < n; i += 1) remaining.add(i);
  const path: number[] = [0];
  let current = 0;
  while (remaining.size > 0) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of remaining) {
      if (dist[current][candidate] < bestDistance) {
        bestDistance = dist[current][candidate];
        best = candidate;
      }
    }
    path.push(best);
    remaining.delete(best);
    current = best;
  }

  // 2-opt on the open path: the origin stays fixed, the last stop is free.
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < path.length - 1; i += 1) {
      for (let k = i + 1; k < path.length; k += 1) {
        const a = path[i - 1];
        const b = path[i];
        const c = path[k];
        const d = k + 1 < path.length ? path[k + 1] : null;
        const before = dist[a][b] + (d === null ? 0 : dist[c][d]);
        const after = dist[a][c] + (d === null ? 0 : dist[b][d]);
        if (after + 1e-6 < before) {
          path.splice(i, k - i + 1, ...path.slice(i, k + 1).reverse());
          improved = true;
        }
      }
    }
  }

  return [...path.slice(1).map((index) => routable[index - 1]), ...unroutable];
}

/** Total length in metres of the open path origin -> stops in order (straight line, no detour). */
/**
 * Moves one stop to the place of another in the order the courier drives
 * them (drag and drop on the dispatch board): the moved stop takes the
 * target's position and the rest keep their relative order. Returns the
 * list unchanged when either id is missing or both are the same.
 */
export function reorderStopIds(ids: readonly string[], movingId: string, targetId: string): string[] {
  const from = ids.indexOf(movingId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = ids.filter((id) => id !== movingId);
  next.splice(to, 0, movingId);
  return next;
}

export function pathLengthMeters(origin: GeoPoint, points: readonly GeoPoint[]): number {
  let total = 0;
  let previous = origin;
  for (const point of points) {
    total += haversineMeters(previous, point);
    previous = point;
  }
  return total;
}

// -- ETA ---------------------------------------------------------------------------

export interface StopEta {
  stopId: string;
  /** Cumulative road distance from the origin, null for a stop without coordinates. */
  distanceMeters: number | null;
  /** Cumulative travel plus hand-over time, null for a stop without coordinates. */
  etaSeconds: number | null;
  etaAt: string | null;
}

/**
 * Cumulative ETAs for stops in sequence, starting at `startAt` from `origin`
 * (the restaurant before departure, the courier's last position after it).
 */
export function estimateStopEtas(
  origin: GeoPoint,
  stops: readonly RoutableStop[],
  legs: readonly RouteLeg[],
  settings: DispatchSettings,
  startAt: Date,
): StopEta[] {
  const result: StopEta[] = [];
  let distance = 0;
  let seconds = 0;
  let legIndex = 0;
  for (const stop of stops) {
    if (!stop.point) {
      result.push({ stopId: stop.id, distanceMeters: null, etaSeconds: null, etaAt: null });
      continue;
    }
    const leg = legs[legIndex];
    legIndex += 1;
    if (!leg) {
      result.push({ stopId: stop.id, distanceMeters: null, etaSeconds: null, etaAt: null });
      continue;
    }
    distance += leg.distanceMeters;
    seconds += leg.durationSeconds;
    const etaSeconds = seconds;
    result.push({
      stopId: stop.id,
      distanceMeters: distance,
      etaSeconds,
      etaAt: new Date(startAt.getTime() + etaSeconds * 1000).toISOString(),
    });
    seconds += settings.stopServiceMinutes * 60;
  }
  void origin;
  return result;
}

// -- Request schemas -----------------------------------------------------------------

/** Delivery address as it was at order time; never a live reference to the customer's address book. */
export const AddressSnapshotSchema = z
  .object({
    addressLine: z.string().trim().min(5).max(300),
    city: z.string().trim().min(1).max(80),
    district: z.string().trim().min(1).max(80),
    postalCode: z.string().trim().max(16).optional(),
    note: z.string().trim().max(300).optional(),
    contactName: z.string().trim().min(1).max(120),
    contactPhone: PhoneSchema,
    /** Geocoded point; null when unknown (the stop then cannot be routed or given an ETA). */
    point: GeoPointSchema.nullable().default(null),
  })
  .strict();
export type AddressSnapshot = z.infer<typeof AddressSnapshotSchema>;

export const OrderLineInputSchema = z
  .object({
    menuItemId: UuidSchema,
    quantity: z.number().int().min(1).max(99),
    modifiers: z
      .array(z.object({ name: z.string().trim().min(1).max(80), priceDeltaMinor: z.number().int() }).strict())
      .max(20)
      .default([]),
  })
  .strict();
export type OrderLineInput = z.infer<typeof OrderLineInputSchema>;

export const CreateOrderSchema = z
  .object({
    branchId: UuidSchema,
    channel: OrderChannelValueSchema,
    fulfillment: FulfillmentTypeValueSchema,
    tableId: UuidSchema.optional(),
    customer: z
      .object({ phone: PhoneSchema, fullName: z.string().trim().min(1).max(120) })
      .strict()
      .optional(),
    items: z.array(OrderLineInputSchema).min(1).max(100),
    address: AddressSnapshotSchema.optional(),
    deliveryFeeMinor: MinorAmountSchema.default(0),
    /** How the order will be paid; omitted for a staff order whose payment is settled outside the platform. */
    payment: OrderPaymentIntentSchema.optional(),
    note: z.string().trim().max(500).optional(),
    /** Anonymous QR session of the guest, to record the PLACED_ORDER funnel step. */
    qrSessionId: z.string().trim().min(8).max(64).optional(),
    /** The customer ticked the marketing consent box; true records consent, false or absent changes nothing. */
    marketingOptIn: z.boolean().optional(),
  })
  .strict()
  .superRefine((order, ctx) => {
    if (order.fulfillment === 'DELIVERY' && !order.address) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['address'], message: 'address is required for delivery' });
    }
    if (order.fulfillment === 'DINE_IN' && !order.tableId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tableId'], message: 'tableId is required for dine-in' });
    }
  });
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export const OrderTransitionSchema = z
  .object({
    to: OrderStatusValueSchema,
    reason: z.string().trim().max(300).optional(),
    /** Only with ACCEPTED: how long the kitchen needs; sets promisedReadyAt. */
    prepMinutes: z.number().int().min(1).max(240).optional(),
  })
  .strict();
export type OrderTransitionInput = z.infer<typeof OrderTransitionSchema>;

export const OrdersQuerySchema = z
  .object({
    status: z.array(OrderStatusValueSchema).optional(),
    fulfillment: FulfillmentTypeValueSchema.optional(),
    /** Only orders that still need attention (not terminal). */
    active: z.coerce.boolean().optional(),
    /** Orders of one customer (the customer list's detail). */
    customerUserId: UuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();
export type OrdersQuery = z.infer<typeof OrdersQuerySchema>;

export const CreateTripSchema = z
  .object({
    courierMembershipId: UuidSchema.optional(),
    /** In the restaurant's chosen order when sequenceMode is MANUAL. */
    orderIds: z.array(UuidSchema).min(1).max(12),
    sequenceMode: StopSequenceModeValueSchema.default('MANUAL'),
  })
  .strict();
export type CreateTripInput = z.infer<typeof CreateTripSchema>;

export const AssignCourierSchema = z.object({ courierMembershipId: UuidSchema }).strict();
export const AddStopSchema = z.object({ orderId: UuidSchema }).strict();
export const ReorderStopsSchema = z.object({ stopIds: z.array(UuidSchema).min(1).max(12) }).strict();
export const StopFailureSchema = z.object({ reason: z.string().trim().min(2).max(300) }).strict();
export const CancelTripSchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();

export const LocationPointSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    recordedAt: z.string().datetime(),
    headingDeg: z.number().min(0).max(360).optional(),
    speedMps: z.number().min(0).max(100).optional(),
    accuracyM: z.number().min(0).max(5000).optional(),
  })
  .strict();
/** Couriers send positions in small batches so a short offline gap is replayed, not lost. */
export const LocationPingSchema = z.object({ points: z.array(LocationPointSchema).min(1).max(60) }).strict();
export type LocationPingInput = z.infer<typeof LocationPingSchema>;

export const TripsQuerySchema = z
  .object({
    status: z.array(z.nativeEnum(DeliveryTripStatus)).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

// -- Tracking token ------------------------------------------------------------------

/** Unguessable public handle of an order's tracking page (/t/<token>). */
export const TRACKING_TOKEN_BYTES = 24;
export const TrackingTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);

export function trackingUrl(publicAppUrl: string, token: string): string {
  let base = publicAppUrl;
  while (base.endsWith('/')) base = base.slice(0, -1);
  return `${base}/t/${token}`;
}

// -- DTOs --------------------------------------------------------------------------------

export interface OrderItemDTO {
  id: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  modifiers: { name: string; priceDeltaMinor: number }[];
  /** How many of this line earlier refunds gave back (docs/ODEME.md, "Kısmi iade"). */
  refundedQuantity: number;
}

export interface OrderStatusChangeDTO {
  from: OrderStatusValue | null;
  to: OrderStatusValue;
  reason: string | null;
  at: string;
}

export interface OrderCustomerDTO {
  userId: string | null;
  fullName: string | null;
  /** Masked for roles without customers.contact.view. */
  phone: string | null;
}

/** What a dispatch or orders screen lists. */
export interface OrderSummaryDTO {
  id: string;
  shortCode: string;
  restaurantId: string;
  branchId: string;
  channel: OrderChannelValue;
  fulfillment: FulfillmentTypeValue;
  status: OrderStatusValue;
  currency: string;
  chargedToCustomerMinor: number;
  itemCount: number;
  tableLabel: string | null;
  customer: OrderCustomerDTO;
  address: AddressSnapshot | null;
  note: string | null;
  placedAt: string;
  acceptedAt: string | null;
  promisedReadyAt: string | null;
  readyAt: string | null;
  estimatedDeliveryAt: string | null;
  completedAt: string | null;
  /** PLACED orders: the moment the acceptance alarm fires; null once accepted or for paid-first orders still pending. */
  acceptDeadlineAt: string | null;
  /** The trip this order currently rides in, when any. */
  activeTrip: { tripId: string; stopId: string; sequence: number; tripStatus: DeliveryTripStatusValue } | null;
  /** Chosen method, issuer and what is still due at the door (docs/YEMEK_KARTI.md). */
  payment: OrderPaymentDTO;
}

export interface OrderDetailDTO extends OrderSummaryDTO {
  items: OrderItemDTO[];
  history: OrderStatusChangeDTO[];
  trackingUrl: string;
  itemsGrossMinor: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  restaurantPayableMinor: number;
  platformReceivableMinor: number;
  /** Every refund of the order, oldest first. */
  refunds: OrderRefundDTO[];
}

export interface CourierPositionDTO {
  lat: number;
  lng: number;
  headingDeg: number | null;
  speedMps: number | null;
  accuracyM: number | null;
  recordedAt: string;
}

export interface CourierSummaryDTO {
  membershipId: string;
  userId: string;
  fullName: string;
  phone: string | null;
  position: CourierPositionDTO | null;
  /** Trip the courier is currently driving, if any. */
  activeTripId: string | null;
}

export interface DeliveryStopDTO {
  id: string;
  tripId: string;
  orderId: string;
  orderShortCode: string;
  orderStatus: OrderStatusValue;
  sequence: number;
  status: DeliveryStopStatusValue;
  point: GeoPoint | null;
  address: AddressSnapshot | null;
  distanceMeters: number | null;
  etaAt: string | null;
  arrivedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
}

export interface DeliveryTripDTO {
  id: string;
  restaurantId: string;
  branchId: string;
  status: DeliveryTripStatusValue;
  sequenceMode: StopSequenceModeValue;
  /** Where the courier picks the orders up: the branch's coordinates, null until the branch has them. */
  pickupPoint: GeoPoint | null;
  courier: CourierSummaryDTO | null;
  stops: DeliveryStopDTO[];
  plannedDistanceMeters: number | null;
  plannedDurationSeconds: number | null;
  createdAt: string;
  assignedAt: string | null;
  pickedUpAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

/** Everything the dispatch screen shows at once. */
export interface DispatchBoardDTO {
  /** Delivery orders that are READY and not yet in an active trip. */
  readyOrders: OrderSummaryDTO[];
  /** Orders still in the kitchen (ACCEPTED, PREPARING), so the dispatcher can plan ahead. */
  upcomingOrders: OrderSummaryDTO[];
  activeTrips: DeliveryTripDTO[];
  couriers: CourierSummaryDTO[];
  settings: DispatchSettings;
}

/** The customer's tracking page. No other customer's data ever appears here. */
export interface OrderTrackingDTO {
  orderId: string;
  shortCode: string;
  status: OrderStatusValue;
  fulfillment: FulfillmentTypeValue;
  restaurant: { name: string; logoUrl: string | null; themePrimary: string; phone: string | null };
  items: { name: string; quantity: number }[];
  placedAt: string;
  promisedReadyAt: string | null;
  estimatedDeliveryAt: string | null;
  completedAt: string | null;
  history: OrderStatusChangeDTO[];
  /** Present once a courier is on the way with this order. */
  courier: {
    firstName: string;
    position: CourierPositionDTO | null;
    distanceMeters: number | null;
    /** How many other deliveries the courier makes before this one. */
    stopsAhead: number;
  } | null;
  destination: GeoPoint | null;
  /** The customer's rating once given (docs/VITRIN.md); canRate says whether the page should still ask. */
  rating: OrderRatingDTO | null;
  canRate: boolean;
}

// -- Realtime events -----------------------------------------------------------------

/**
 * One event stream per audience (docs/SIPARIS_VE_SEVK.md): the restaurant's
 * dispatch board, the courier's own trips and the customer's order. Events
 * carry the full current state of the entity, so a client that missed one
 * is still correct after the next.
 */
export type RealtimeEvent =
  | { type: 'order.updated'; order: OrderSummaryDTO }
  | { type: 'trip.updated'; trip: DeliveryTripDTO }
  | { type: 'courier.location'; tripId: string; membershipId: string; position: CourierPositionDTO; stops: StopEta[] }
  | { type: 'tracking.updated'; tracking: OrderTrackingDTO };

export type RealtimeEventType = RealtimeEvent['type'];

export const REALTIME_HEARTBEAT_SECONDS = 25;
export const REALTIME_RETRY_MILLIS = 3000;

/** Short human-readable order code shown on screens and receipts: last 6 characters of the id, upper-cased. */
export function orderShortCode(orderId: string): string {
  return orderId.replace(/-/g, '').slice(-6).toUpperCase();
}

/** First name only; the customer sees who is coming, not the courier's full identity. */
export function courierDisplayName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** Masks a phone for roles that may not see customer contacts: +9053*****33. */
export function maskPhoneForDisplay(phone: string): string {
  if (phone.length < 6) return '***';
  return `${phone.slice(0, 5)}${'*'.repeat(Math.max(0, phone.length - 7))}${phone.slice(-2)}`;
}
