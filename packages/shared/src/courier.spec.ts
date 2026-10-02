import { CourierQuoteRequestSchema, customerDeliveryFee } from './courier';

describe('courier fee policy', () => {
  it('passes the quote through, rounded up to the chosen step', () => {
    expect(customerDeliveryFee(4321, 50000, { mode: 'PASS_THROUGH' })).toBe(4321);
    expect(customerDeliveryFee(4321, 50000, { mode: 'PASS_THROUGH', roundUpToMinor: 500 })).toBe(4500);
    expect(customerDeliveryFee(4500, 50000, { mode: 'PASS_THROUGH', roundUpToMinor: 500 })).toBe(4500);
  });

  it('fixed and free-above policies ignore the quote', () => {
    expect(customerDeliveryFee(9999, 1000, { mode: 'FIXED', feeMinor: 2500 })).toBe(2500);
    expect(customerDeliveryFee(9999, 1000, { mode: 'FREE_ABOVE', thresholdMinor: 30000, feeMinor: 2500 })).toBe(2500);
    expect(customerDeliveryFee(9999, 30000, { mode: 'FREE_ABOVE', thresholdMinor: 30000, feeMinor: 2500 })).toBe(0);
  });

  it('validates a quote request', () => {
    const stop = {
      address: 'Ornek Mah. 1. Sk. No 3',
      point: { lat: 41.01, lng: 28.97 },
      contactName: 'A',
      contactPhone: '+905321112233',
    };
    const ok = CourierQuoteRequestSchema.safeParse({
      restaurantId: '11111111-1111-4111-8111-111111111111',
      pickup: stop,
      dropoff: stop,
      parcelValueMinor: 70000,
      currency: 'TRY',
    });
    expect(ok.success).toBe(true);
    expect(CourierQuoteRequestSchema.safeParse({ ...ok.data, currency: 'tl' }).success).toBe(false);
  });
});
