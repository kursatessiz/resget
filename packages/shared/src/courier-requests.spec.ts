import { canTransitionOrder } from './delivery';
import type { OrderStatusValue } from './delivery';
import { courierCallActions, networkOrderSteps, nextDeliveryRequestStatus } from './courier-requests';

describe('courier network requests', () => {
  it('moves a request forward only and ends it on a cancellation or failure', () => {
    expect(nextDeliveryRequestStatus('REQUESTED', 'ASSIGNED')).toBe('ASSIGNED');
    expect(nextDeliveryRequestStatus('ASSIGNED', 'ASSIGNED')).toBeNull();
    expect(nextDeliveryRequestStatus('PICKED_UP', 'ASSIGNED')).toBeNull();
    expect(nextDeliveryRequestStatus('REQUESTED', 'DELIVERED')).toBe('DELIVERED');
    expect(nextDeliveryRequestStatus('PICKED_UP', 'FAILED')).toBe('FAILED');
    expect(nextDeliveryRequestStatus('DELIVERED', 'CANCELLED')).toBeNull();
    expect(nextDeliveryRequestStatus('CANCELLED', 'ASSIGNED')).toBeNull();
  });

  it('walks the order along transitions the status machine allows', () => {
    const walk = (from: OrderStatusValue, kind: Parameters<typeof networkOrderSteps>[1]) => {
      let status = from;
      for (const step of networkOrderSteps(from, kind)) {
        expect(canTransitionOrder('DELIVERY', status, step.to, step.actor)).toBe(true);
        status = step.to;
      }
      return status;
    };
    expect(walk('PREPARING', 'ASSIGNED')).toBe('PREPARING');
    expect(walk('READY', 'ASSIGNED')).toBe('HANDED_TO_COURIER');
    expect(walk('PREPARING', 'PICKED_UP')).toBe('OUT_FOR_DELIVERY');
    expect(walk('HANDED_TO_COURIER', 'PICKED_UP')).toBe('OUT_FOR_DELIVERY');
    expect(walk('ACCEPTED', 'DELIVERED')).toBe('DELIVERED');
    expect(walk('ARRIVING', 'DELIVERED')).toBe('DELIVERED');
    expect(walk('OUT_FOR_DELIVERY', 'FAILED')).toBe('READY');
    expect(walk('PREPARING', 'CANCELLED')).toBe('PREPARING');
    expect(walk('DELIVERED', 'DELIVERED')).toBe('DELIVERED');
  });

  it('offers a call and a cancellation only when they can work', () => {
    const order = {
      fulfillment: 'DELIVERY' as const,
      status: 'PREPARING' as const,
      activeTrip: null,
      courierRequest: null,
    };
    expect(courierCallActions(order, true)).toEqual({ call: true, cancel: false });
    expect(courierCallActions(order, false)).toEqual({ call: false, cancel: false });
    expect(courierCallActions({ ...order, fulfillment: 'PICKUP' }, true).call).toBe(false);
    expect(courierCallActions({ ...order, status: 'PLACED' }, true).call).toBe(false);
    const request = (status: 'REQUESTED' | 'PICKED_UP' | 'FAILED') => ({
      id: 'r',
      orderId: 'o',
      orderShortCode: 'ABC123',
      status,
      quoteFeeMinor: 4000,
      finalFeeMinor: null,
      currency: 'TRY',
      providerName: 'Ag',
      providerRef: 'x',
      trackingUrl: null,
      pickupEtaMinutes: 10,
      dropoffEtaMinutes: 20,
      failureReason: null,
      createdAt: '2026-10-06T00:00:00.000Z',
    });
    expect(courierCallActions({ ...order, courierRequest: request('REQUESTED') }, true)).toEqual({
      call: false,
      cancel: true,
    });
    expect(courierCallActions({ ...order, courierRequest: request('PICKED_UP') }, true)).toEqual({
      call: false,
      cancel: false,
    });
    expect(courierCallActions({ ...order, courierRequest: request('FAILED') }, true)).toEqual({
      call: true,
      cancel: false,
    });
  });
});
