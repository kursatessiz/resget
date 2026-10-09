import { freshPlacedOrderIds, orderActionsFor } from './order-actions';

const order = (status: string, fulfillment = 'DELIVERY', activeTrip: unknown = null) =>
  ({ status, fulfillment, activeTrip }) as Parameters<typeof orderActionsFor>[0];

describe('order actions', () => {
  it('offers accept with a prep time and reject with a reason for a new order', () => {
    expect(orderActionsFor(order('PLACED'))).toEqual([
      { to: 'ACCEPTED', labelKey: 'orders.accept', needsPrep: true },
      { to: 'REJECTED', labelKey: 'orders.reject', tone: 'error', needsReason: true },
    ]);
  });

  it('lets the restaurant call off an order still waiting for its payment, with a reason', () => {
    expect(orderActionsFor(order('PENDING_PAYMENT'))).toEqual([
      { to: 'CANCELLED_BY_RESTAURANT', labelKey: 'orders.cancel', tone: 'error', needsReason: true },
    ]);
  });

  it('ends a ready order by its fulfilment and leaves orders on a trip alone', () => {
    expect(orderActionsFor(order('READY', 'PICKUP')).map((a) => a.to)).toEqual(['PICKED_UP']);
    expect(orderActionsFor(order('READY', 'DINE_IN')).map((a) => a.to)).toEqual(['DELIVERED']);
    expect(orderActionsFor(order('READY')).map((a) => a.to)).toEqual(['OUT_FOR_DELIVERY', 'CANCELLED_BY_RESTAURANT']);
    expect(orderActionsFor(order('READY', 'DELIVERY', { tripId: 't' }))).toEqual([]);
    expect(orderActionsFor(order('DELIVERED'))).toEqual([]);
  });

  it('finds new orders once', () => {
    const orders = [
      { id: 'a', status: 'PLACED' },
      { id: 'b', status: 'ACCEPTED' },
      { id: 'c', status: 'PLACED' },
    ] as Parameters<typeof freshPlacedOrderIds>[0];
    expect(freshPlacedOrderIds(orders, new Set(['a']))).toEqual(['c']);
  });
});
