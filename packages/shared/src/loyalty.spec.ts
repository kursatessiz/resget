import { LoyaltyProgramSchema, balanceValueMinor, pointsEarnedFor, redeemableFor } from './loyalty';

const rule = {
  enabled: true,
  earnPoints: 1,
  earnStepMinor: 1000,
  redeemPoints: 100,
  redeemValueMinor: 5000,
  minOrderMinor: 10000,
  maxDiscountBps: 5000,
  welcomePoints: 50,
};

describe('loyalty arithmetic', () => {
  it('earns whole steps only and nothing on a zero or negative spend', () => {
    expect(pointsEarnedFor(rule, 24_999)).toBe(24);
    expect(pointsEarnedFor(rule, 999)).toBe(0);
    expect(pointsEarnedFor(rule, 0)).toBe(0);
    expect(pointsEarnedFor(rule, -500)).toBe(0);
    expect(pointsEarnedFor({ earnPoints: 3, earnStepMinor: 250 }, 1000)).toBe(12);
  });

  it('redeems whole steps, capped by the discount ceiling and the items total', () => {
    // 250 points = 2 steps = 100.00; the ceiling (50 percent of 300.00) allows 3 steps, so the balance limits.
    expect(redeemableFor(rule, 250, 30_000)).toEqual({ points: 200, discountMinor: 10_000 });
    // 1000 points could buy 500.00 but the ceiling on a 120.00 order is 60.00: one step.
    expect(redeemableFor(rule, 1000, 12_000)).toEqual({ points: 100, discountMinor: 5000 });
    // Below the minimum order or below one step: nothing.
    expect(redeemableFor(rule, 1000, 9999)).toEqual({ points: 0, discountMinor: 0 });
    expect(redeemableFor(rule, 99, 50_000)).toEqual({ points: 0, discountMinor: 0 });
    // The discount never exceeds the items total even with a full ceiling.
    expect(redeemableFor({ ...rule, maxDiscountBps: 10_000, minOrderMinor: 0 }, 1000, 7000)).toEqual({
      points: 100,
      discountMinor: 5000,
    });
  });

  it('values a balance in whole steps', () => {
    expect(balanceValueMinor(rule, 349)).toBe(15_000);
    expect(balanceValueMinor(rule, 99)).toBe(0);
  });

  it('rejects a program without a positive ceiling or with fractional values', () => {
    expect(LoyaltyProgramSchema.safeParse(rule).success).toBe(true);
    expect(LoyaltyProgramSchema.safeParse({ ...rule, maxDiscountBps: 0 }).success).toBe(false);
    expect(LoyaltyProgramSchema.safeParse({ ...rule, earnStepMinor: 10.5 }).success).toBe(false);
    expect(LoyaltyProgramSchema.safeParse({ ...rule, extra: true }).success).toBe(false);
  });
});
