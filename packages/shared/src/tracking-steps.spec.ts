import {
  TRACKING_STEPS,
  isTrackingEnded,
  trackingStatusMessageKey,
  trackingStepIndex,
  trackingTokenFromLink,
} from './tracking-steps';

describe('tracking steps', () => {
  it('maps statuses onto the ladder of each fulfillment type', () => {
    expect(trackingStepIndex('PLACED', 'DELIVERY')).toBe(0);
    expect(trackingStepIndex('READY', 'DELIVERY')).toBe(3);
    expect(trackingStepIndex('READY', 'DINE_IN')).toBe(2);
    expect(trackingStepIndex('ARRIVING', 'DELIVERY')).toBe(4);
    expect(trackingStepIndex('DELIVERED', 'DELIVERY')).toBe(TRACKING_STEPS.DELIVERY.length - 1);
    expect(trackingStepIndex('PICKED_UP', 'PICKUP')).toBe(TRACKING_STEPS.PICKUP.length - 1);
    expect(trackingStepIndex('REJECTED', 'PICKUP')).toBe(-1);
  });

  it('knows when an order stopped changing and which sentence to show', () => {
    expect(isTrackingEnded('DELIVERED')).toBe(true);
    expect(isTrackingEnded('OUT_FOR_DELIVERY')).toBe(false);
    expect(trackingStatusMessageKey('READY', 'DELIVERY')).toBe('tracking.status.READY.DELIVERY');
    expect(trackingStatusMessageKey('READY', 'PICKUP')).toBe('tracking.status.READY');
  });

  it('extracts the token from web, scheme and path forms of a tracking link and nothing else', () => {
    expect(trackingTokenFromLink('https://resget.example/t/abcDEF123456?utm=x')).toBe('abcDEF123456');
    expect(trackingTokenFromLink('resget://t/abcDEF123456')).toBe('abcDEF123456');
    expect(trackingTokenFromLink('/t/abcDEF123456')).toBe('abcDEF123456');
    expect(trackingTokenFromLink('https://resget.example/m/abcDEF123456')).toBeNull();
    expect(trackingTokenFromLink('https://resget.example/t/short')).toBeNull();
    expect(trackingTokenFromLink('https://resget.example/t/../etc')).toBeNull();
  });
});
