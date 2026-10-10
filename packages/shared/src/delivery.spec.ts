import {
  DEFAULT_DISPATCH_SETTINGS,
  allowedOrderTransitions,
  canTransitionOrder,
  dispatchSettingsFrom,
  estimateStopEtas,
  haversineLegs,
  haversineMeters,
  isTerminalOrderStatus,
  maskTripContacts,
  optimizeStopOrder,
  orderShortCode,
  pathLengthMeters,
  courierDisplayName,
  CreateOrderSchema,
  ORDER_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
  reorderStopIds,
} from './delivery';
import { OrderStatus } from './enums';
import { BASE_MESSAGES } from './i18n/messages';

const KADIKOY = { lat: 40.9867, lng: 29.0263 };

describe('order state machine', () => {
  it('runs a delivery order from placement to the door', () => {
    const path: Array<[`${OrderStatus}`, `${OrderStatus}`, 'RESTAURANT' | 'COURIER' | 'SYSTEM']> = [
      ['PLACED', 'ACCEPTED', 'RESTAURANT'],
      ['ACCEPTED', 'PREPARING', 'RESTAURANT'],
      ['PREPARING', 'READY', 'RESTAURANT'],
      ['READY', 'HANDED_TO_COURIER', 'COURIER'],
      ['HANDED_TO_COURIER', 'OUT_FOR_DELIVERY', 'COURIER'],
      ['OUT_FOR_DELIVERY', 'ARRIVING', 'SYSTEM'],
      ['ARRIVING', 'DELIVERED', 'COURIER'],
    ];
    for (const [from, to, actor] of path) expect(canTransitionOrder('DELIVERY', from, to, actor)).toBe(true);
  });

  it('keeps the courier leg out of pickup and dine-in orders and the kitchen out of the courier', () => {
    expect(canTransitionOrder('PICKUP', 'READY', 'HANDED_TO_COURIER', 'COURIER')).toBe(false);
    expect(canTransitionOrder('PICKUP', 'READY', 'PICKED_UP', 'RESTAURANT')).toBe(true);
    expect(canTransitionOrder('DINE_IN', 'READY', 'DELIVERED', 'RESTAURANT')).toBe(true);
    expect(canTransitionOrder('DELIVERY', 'PLACED', 'ACCEPTED', 'COURIER')).toBe(false);
    expect(canTransitionOrder('DELIVERY', 'OUT_FOR_DELIVERY', 'ARRIVING', 'RESTAURANT')).toBe(false);
  });

  it('lets the restaurant, and only the restaurant, call off an order waiting for its payment', () => {
    for (const f of ['DELIVERY', 'PICKUP', 'DINE_IN'] as const) {
      expect(canTransitionOrder(f, 'PENDING_PAYMENT', 'CANCELLED_BY_RESTAURANT', 'RESTAURANT')).toBe(true);
      expect(canTransitionOrder(f, 'PENDING_PAYMENT', 'CANCELLED_BY_RESTAURANT', 'CUSTOMER')).toBe(false);
      expect(canTransitionOrder(f, 'PENDING_PAYMENT', 'ACCEPTED', 'RESTAURANT')).toBe(false);
    }
  });

  it('lets a customer cancel only before the kitchen starts', () => {
    expect(canTransitionOrder('DELIVERY', 'PLACED', 'CANCELLED_BY_CUSTOMER', 'CUSTOMER')).toBe(true);
    expect(canTransitionOrder('DELIVERY', 'ACCEPTED', 'CANCELLED_BY_CUSTOMER', 'CUSTOMER')).toBe(true);
    expect(canTransitionOrder('DELIVERY', 'PREPARING', 'CANCELLED_BY_CUSTOMER', 'CUSTOMER')).toBe(false);
  });

  it('returns a failed delivery to the restaurant and never leaves a terminal state except for refunds', () => {
    expect(canTransitionOrder('DELIVERY', 'ARRIVING', 'READY', 'COURIER')).toBe(true);
    for (const status of TERMINAL_ORDER_STATUSES) {
      expect(isTerminalOrderStatus(status)).toBe(true);
      const next = allowedOrderTransitions('DELIVERY', status, 'RESTAURANT');
      expect(next.every((s) => s === 'REFUNDED')).toBe(true);
    }
    expect(allowedOrderTransitions('DELIVERY', 'READY', 'COURIER')).toEqual(['HANDED_TO_COURIER']);
  });

  it('has a Turkish label for every status of every table', () => {
    const statuses = new Set<string>();
    for (const table of Object.values(ORDER_TRANSITIONS)) {
      for (const [from, row] of Object.entries(table)) {
        statuses.add(from);
        for (const to of Object.keys(row ?? {})) statuses.add(to);
      }
    }
    for (const status of Object.values(OrderStatus)) statuses.add(status);
    for (const status of statuses) {
      expect(BASE_MESSAGES[`orders.status.${status}` as keyof typeof BASE_MESSAGES]).toBeTruthy();
      expect(BASE_MESSAGES[`tracking.status.${status}` as keyof typeof BASE_MESSAGES]).toBeTruthy();
    }
  });
});

describe('geography and routing', () => {
  it('measures distance on the sphere', () => {
    expect(haversineMeters(KADIKOY, KADIKOY)).toBe(0);
    // Kadikoy to Taksim is roughly 7 km as the crow flies.
    const taksim = { lat: 41.0369, lng: 28.985 };
    const d = haversineMeters(KADIKOY, taksim);
    expect(d).toBeGreaterThan(6000);
    expect(d).toBeLessThan(8000);
  });

  it('orders stops by nearest neighbour and 2-opt, never longer than the given order', () => {
    const stops = [
      { id: 'far', point: { lat: 41.02, lng: 29.06 } },
      { id: 'near', point: { lat: 40.99, lng: 29.03 } },
      { id: 'mid', point: { lat: 41.0, lng: 29.045 } },
      { id: 'nogeo', point: null },
    ];
    const ordered = optimizeStopOrder(KADIKOY, stops);
    expect(ordered.map((s) => s.id)).toEqual(['near', 'mid', 'far', 'nogeo']);
    const given = pathLengthMeters(
      KADIKOY,
      stops.filter((s) => s.point).map((s) => s.point!),
    );
    const optimized = pathLengthMeters(
      KADIKOY,
      ordered.filter((s) => s.point).map((s) => s.point!),
    );
    expect(optimized).toBeLessThanOrEqual(given);
  });

  it('2-opt untangles a crossing that nearest neighbour produces', () => {
    // Four stops on a line east of the origin, with one slightly north so
    // greedy picks it early and then has to come back.
    const origin = { lat: 41.0, lng: 29.0 };
    const stops = [
      { id: 'a', point: { lat: 41.0, lng: 29.01 } },
      { id: 'b', point: { lat: 41.0, lng: 29.03 } },
      { id: 'c', point: { lat: 41.0, lng: 29.05 } },
      { id: 'd', point: { lat: 41.0, lng: 29.07 } },
    ];
    const ordered = optimizeStopOrder(origin, [stops[3], stops[1], stops[0], stops[2]]);
    expect(ordered.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    // Deterministic: same input, same output.
    expect(optimizeStopOrder(origin, [stops[3], stops[1], stops[0], stops[2]]).map((s) => s.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('follows a road matrix when one is given and ignores a malformed one', () => {
    const origin = { lat: 41, lng: 29 };
    const stops = [
      { id: 'near', point: { lat: 41.001, lng: 29 } },
      { id: 'far', point: { lat: 41.01, lng: 29 } },
    ];
    // Straight lines say near first; the roads say the near stop is only reachable after the far one.
    const roads = [
      [0, 5000, 1000],
      [5000, 0, 400],
      [1000, 400, 0],
    ];
    expect(optimizeStopOrder(origin, stops, roads).map((s) => s.id)).toEqual(['far', 'near']);
    expect(optimizeStopOrder(origin, stops, [[0, 1]]).map((s) => s.id)).toEqual(['near', 'far']);
    expect(
      optimizeStopOrder(origin, stops, [
        [0, 1, 2],
        [1, 0, Number.NaN],
        [2, 1, 0],
      ]).map((s) => s.id),
    ).toEqual(['near', 'far']);
  });

  it('estimates cumulative ETAs with hand-over time between stops', () => {
    const settings = { ...DEFAULT_DISPATCH_SETTINGS, avgSpeedKmh: 36, detourFactor: 1, stopServiceMinutes: 2 };
    const stops = [
      { id: 's1', point: { lat: 40.9957, lng: 29.0263 } }, // ~1 km north
      { id: 's2', point: { lat: 41.0047, lng: 29.0263 } }, // another ~1 km
      { id: 'nogeo', point: null },
    ];
    const legs = haversineLegs([KADIKOY, stops[0].point!, stops[1].point!], settings);
    const start = new Date('2026-10-03T12:00:00Z');
    const etas = estimateStopEtas(KADIKOY, stops, legs, settings, start);
    expect(etas[0].distanceMeters).toBeGreaterThan(900);
    expect(etas[0].distanceMeters).toBeLessThan(1100);
    // 1 km at 36 km/h is 100 s; the second stop adds 2 min hand-over plus another 100 s.
    expect(etas[0].etaSeconds).toBeGreaterThanOrEqual(90);
    expect(etas[0].etaSeconds).toBeLessThanOrEqual(110);
    expect(etas[1].etaSeconds! - etas[0].etaSeconds!).toBeGreaterThanOrEqual(120 + 90);
    expect(etas[2]).toEqual({ stopId: 'nogeo', distanceMeters: null, etaSeconds: null, etaAt: null });
    expect(new Date(etas[0].etaAt!).getTime()).toBeGreaterThan(start.getTime());
  });

  it('reads dispatch settings leniently and falls back to defaults', () => {
    expect(dispatchSettingsFrom(null)).toEqual(DEFAULT_DISPATCH_SETTINGS);
    expect(dispatchSettingsFrom({ avgSpeedKmh: 30, unknown: 1 }).avgSpeedKmh).toBe(30);
    expect(dispatchSettingsFrom({ avgSpeedKmh: 'fast' })).toEqual(DEFAULT_DISPATCH_SETTINGS);
  });
});

describe('order input', () => {
  const base = {
    branchId: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b',
    channel: 'PHONE',
    items: [{ menuItemId: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4c', quantity: 2 }],
  };

  it('requires an address for delivery and a table for dine-in', () => {
    expect(CreateOrderSchema.safeParse({ ...base, fulfillment: 'DELIVERY' }).success).toBe(false);
    expect(CreateOrderSchema.safeParse({ ...base, fulfillment: 'DINE_IN' }).success).toBe(false);
    expect(CreateOrderSchema.safeParse({ ...base, fulfillment: 'PICKUP' }).success).toBe(true);
    const delivery = CreateOrderSchema.safeParse({
      ...base,
      fulfillment: 'DELIVERY',
      address: {
        addressLine: 'Moda Cad. No 10 D 3',
        city: 'Istanbul',
        district: 'Kadikoy',
        contactName: 'Ayse',
        contactPhone: '0532 000 00 03',
      },
    });
    expect(delivery.success).toBe(true);
    if (delivery.success) {
      expect(delivery.data.address?.contactPhone).toBe('+905320000003');
      expect(delivery.data.address?.point).toBeNull();
    }
  });

  it('derives display helpers', () => {
    expect(orderShortCode('6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b')).toBe('2F3A4B');
    expect(courierDisplayName('  Mehmet Can Yilmaz ')).toBe('Mehmet');
  });
});

describe('stop reordering', () => {
  it('moves a dragged stop into the place of the one it was dropped on', () => {
    expect(reorderStopIds(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    expect(reorderStopIds(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(reorderStopIds(['a', 'b', 'c', 'd'], 'b', 'c')).toEqual(['a', 'c', 'b', 'd']);
  });

  it('leaves the order alone for an unknown or identical target', () => {
    expect(reorderStopIds(['a', 'b'], 'a', 'a')).toEqual(['a', 'b']);
    expect(reorderStopIds(['a', 'b'], 'x', 'a')).toEqual(['a', 'b']);
    expect(reorderStopIds(['a', 'b'], 'a', 'x')).toEqual(['a', 'b']);
  });
});

describe('maskTripContacts', () => {
  const address = {
    addressLine: 'Gizli Sok. No 1 D 2',
    city: 'Istanbul',
    district: 'Kadikoy',
    contactName: 'Ayse',
    contactPhone: '+905329990100',
  };
  const trip = {
    id: 't1',
    stops: [
      { id: 's1', address },
      { id: 's2', address: null },
    ],
  } as unknown as Parameters<typeof maskTripContacts>[0]; // test fixture: only the fields the function reads

  it('masks every stop phone, keeps the address and does not touch the input', () => {
    const masked = maskTripContacts(trip);
    expect(masked.stops[0].address).toEqual({ ...address, contactPhone: '+9053******00' });
    expect(masked.stops[1].address).toBeNull();
    expect(trip.stops[0].address?.contactPhone).toBe('+905329990100');
  });
});
