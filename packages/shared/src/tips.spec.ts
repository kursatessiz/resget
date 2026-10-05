import { StartTipSchema, tipLimits, tipNetMinor, tipPresets, withinTipWindow } from './tips';

describe('courier tips', () => {
  it('suggests shares of the order total within the limits, without repeats', () => {
    expect(tipPresets(25_000, 'TRY')).toEqual([1250, 2500, 3750]);
    // A share below one major unit becomes the minimum.
    expect(tipPresets(1_500, 'TRY')).toEqual([100, 150, 225]);
    expect(tipPresets(900, 'TRY')).toEqual([100, 135]);
    expect(tipPresets(50, 'TRY')).toEqual([]);
  });

  it('takes the minimum from the currency and caps at what the customer paid', () => {
    expect(tipLimits(25_000, 'TRY')).toEqual({ minMinor: 100, maxMinor: 25_000 });
    expect(tipLimits(5_000, 'JPY')).toEqual({ minMinor: 1, maxMinor: 5_000 });
    expect(tipLimits(-10, 'EUR')).toEqual({ minMinor: 100, maxMinor: 0 });
  });

  it('leaves the courier the tip less the provider fee, never below zero', () => {
    expect(tipNetMinor(2_500, 90)).toBe(2_410);
    expect(tipNetMinor(100, 150)).toBe(0);
  });

  it('is open for the rating window after delivery', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    expect(withinTipWindow('2026-10-04T12:00:00Z', now)).toBe(true);
    expect(withinTipWindow('2026-10-02T12:00:00Z', now)).toBe(false);
    expect(withinTipWindow(null, now)).toBe(false);
  });

  it('takes a positive whole amount and a return address', () => {
    expect(StartTipSchema.safeParse({ amountMinor: 500, returnUrl: 'https://x.test/t/a' }).success).toBe(true);
    expect(StartTipSchema.safeParse({ amountMinor: 0, returnUrl: 'https://x.test/t/a' }).success).toBe(false);
    expect(StartTipSchema.safeParse({ amountMinor: 1.5, returnUrl: 'https://x.test/t/a' }).success).toBe(false);
  });
});
