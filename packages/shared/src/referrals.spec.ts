import { REFERRAL_CODE_ALPHABET, UpsertReferralProgramSchema, friendCouponTerms, referralCodeFrom } from './referrals';

describe('customer referrals', () => {
  const rules = {
    isActive: true,
    friendMinBasketMinor: 0,
    rewardAmountMinor: 5000,
    rewardValidDays: 30,
    monthlyCapPerReferrer: 5,
  };

  it('accepts a percent or an amount offer, never both', () => {
    expect(
      UpsertReferralProgramSchema.safeParse({
        ...rules,
        friendKind: 'PERCENT',
        friendPercentBps: 1000,
        friendMaxDiscountMinor: null,
      }).success,
    ).toBe(true);
    expect(
      UpsertReferralProgramSchema.safeParse({ ...rules, friendKind: 'AMOUNT', friendAmountMinor: 2000 }).success,
    ).toBe(true);
    expect(
      UpsertReferralProgramSchema.safeParse({
        ...rules,
        friendKind: 'AMOUNT',
        friendAmountMinor: 2000,
        friendPercentBps: 1000,
      }).success,
    ).toBe(false);
    expect(
      UpsertReferralProgramSchema.safeParse({
        ...rules,
        rewardValidDays: 3,
        friendKind: 'AMOUNT',
        friendAmountMinor: 1,
      }).success,
    ).toBe(false);
    expect(
      UpsertReferralProgramSchema.safeParse({
        ...rules,
        rewardAmountMinor: 0,
        friendKind: 'AMOUNT',
        friendAmountMinor: 1,
      }).success,
    ).toBe(false);
  });

  it('turns the offer into coupon terms', () => {
    expect(
      friendCouponTerms({ ...rules, friendKind: 'PERCENT', friendPercentBps: 1500, friendMaxDiscountMinor: 10000 }),
    ).toEqual({ kind: 'PERCENT', percentBps: 1500, maxDiscountMinor: 10000, amountMinor: null, minBasketMinor: 0 });
    expect(
      friendCouponTerms({ ...rules, friendMinBasketMinor: 30000, friendKind: 'AMOUNT', friendAmountMinor: 2500 }),
    ).toEqual({ kind: 'AMOUNT', percentBps: null, maxDiscountMinor: null, amountMinor: 2500, minBasketMinor: 30000 });
  });

  it('makes eight-character codes from an unambiguous alphabet', () => {
    expect(REFERRAL_CODE_ALPHABET).not.toMatch(/[01ILO]/);
    const code = referralCodeFrom(new Uint8Array([0, 1, 2, 3, 250, 251, 255]), 'R');
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^R[2-9A-HJ-NP-Z]{7}$/);
    expect(referralCodeFrom(new Uint8Array(7), 'W')).toBe('W2222222');
  });
});
