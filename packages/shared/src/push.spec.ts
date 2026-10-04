import { customerPushTemplate, isExpoPushToken, maskPushToken, pushRouteFor } from './push';

describe('push notifications', () => {
  it('accepts only Expo push tokens and masks them for logs', () => {
    expect(isExpoPushToken('ExponentPushToken[abcdefgh1234]')).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[abcdefgh1234]')).toBe(true);
    expect(isExpoPushToken('fcm:abcdefgh1234')).toBe(false);
    expect(maskPushToken('ExponentPushToken[abcdefgh1234]')).toBe('...gh1234]');
  });

  it('pushes the customer on the paid updates plus arriving and completion, never for dine-in', () => {
    expect(customerPushTemplate('DELIVERY', 'ACCEPTED')).toBe('order.accepted');
    expect(customerPushTemplate('DELIVERY', 'ARRIVING')).toBe('order.arriving');
    expect(customerPushTemplate('DELIVERY', 'DELIVERED')).toBe('order.completed');
    expect(customerPushTemplate('PICKUP', 'READY')).toBe('order.readyForPickup');
    expect(customerPushTemplate('PICKUP', 'PICKED_UP')).toBe('order.completed');
    expect(customerPushTemplate('DELIVERY', 'READY')).toBeNull();
    expect(customerPushTemplate('DINE_IN', 'ACCEPTED')).toBeNull();
  });

  it('maps notification data onto app routes and refuses anything else', () => {
    expect(pushRouteFor({ kind: 'tracking', token: 'abcDEF123456' })).toBe('/t/abcDEF123456');
    expect(pushRouteFor({ kind: 'trip', tripId: '7b1a2f3c-4d5e-4f60-8a9b-0c1d2e3f4a5b' })).toBe(
      '/(app)/kurye/7b1a2f3c-4d5e-4f60-8a9b-0c1d2e3f4a5b',
    );
    expect(pushRouteFor({ kind: 'orders' })).toBe('/(app)/siparisler');
    expect(pushRouteFor({ kind: 'tracking', token: '../x' })).toBeNull();
    expect(pushRouteFor({ kind: 'trip', tripId: 'not-a-uuid' })).toBeNull();
    expect(pushRouteFor('nonsense')).toBeNull();
  });
});
