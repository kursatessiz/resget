import {
  CouponCodeSchema,
  CreateCouponSchema,
  couponDiscountMinor,
  couponNeedsIdentity,
  couponRefusal,
} from './coupons';
import type { CouponTerms } from './coupons';

const now = new Date('2026-10-04T12:00:00Z');
const percent: CouponTerms = {
  kind: 'PERCENT',
  percentBps: 1500,
  maxDiscountMinor: 5000,
  amountMinor: null,
  minBasketMinor: 20000,
  firstOrderOnly: false,
  perCustomerLimit: 1,
  maxRedemptions: 100,
  startsAt: null,
  endsAt: null,
  isActive: true,
};
const ok = { now, itemsGrossMinor: 30000, customerOrderCount: 3, customerRedemptions: 0, totalRedemptions: 10 };

describe('coupons', () => {
  it('computes percent with its ceiling and amount never above the total', () => {
    expect(couponDiscountMinor(percent, 30000)).toBe(4500);
    expect(couponDiscountMinor(percent, 100000)).toBe(5000);
    expect(couponDiscountMinor({ ...percent, maxDiscountMinor: null }, 100000)).toBe(15000);
    expect(
      couponDiscountMinor({ kind: 'AMOUNT', percentBps: null, maxDiscountMinor: null, amountMinor: 2500 }, 30000),
    ).toBe(2500);
    expect(
      couponDiscountMinor({ kind: 'AMOUNT', percentBps: null, maxDiscountMinor: null, amountMinor: 2500 }, 1000),
    ).toBe(1000);
  });

  it('checks the window, the limits, the first order and the basket', () => {
    expect(couponRefusal(percent, ok)).toBeNull();
    expect(couponRefusal({ ...percent, isActive: false }, ok)).toBe('COUPON_NOT_FOUND');
    expect(couponRefusal({ ...percent, startsAt: '2026-10-05T00:00:00Z' }, ok)).toBe('COUPON_NOT_FOUND');
    expect(couponRefusal({ ...percent, endsAt: '2026-10-04T12:00:00Z' }, ok)).toBe('COUPON_EXPIRED');
    expect(couponRefusal(percent, { ...ok, totalRedemptions: 100 })).toBe('COUPON_LIMIT_REACHED');
    expect(couponRefusal({ ...percent, maxRedemptions: null }, { ...ok, totalRedemptions: 10_000 })).toBeNull();
    expect(couponRefusal({ ...percent, firstOrderOnly: true }, ok)).toBe('COUPON_FIRST_ORDER_ONLY');
    expect(couponRefusal({ ...percent, firstOrderOnly: true }, { ...ok, customerOrderCount: 0 })).toBeNull();
    expect(couponRefusal(percent, { ...ok, customerRedemptions: 1 })).toBe('COUPON_ALREADY_USED');
    expect(couponRefusal(percent, { ...ok, itemsGrossMinor: 19999 })).toBe('COUPON_MIN_BASKET');
  });

  it('normalises codes and validates the rules', () => {
    expect(CouponCodeSchema.parse(' hosgeldin-10 ')).toBe('HOSGELDIN-10');
    expect(CouponCodeSchema.safeParse('ab').success).toBe(false);
    expect(CouponCodeSchema.safeParse('-ABC').success).toBe(false);
    const base = {
      code: 'ILK10',
      minBasketMinor: 0,
      firstOrderOnly: true,
      perCustomerLimit: 1,
      maxRedemptions: null,
      startsAt: null,
      endsAt: null,
    };
    expect(
      CreateCouponSchema.safeParse({ ...base, kind: 'PERCENT', percentBps: 1000, maxDiscountMinor: null }).success,
    ).toBe(true);
    expect(CreateCouponSchema.safeParse({ ...base, kind: 'AMOUNT', amountMinor: 0 }).success).toBe(false);
    expect(CreateCouponSchema.safeParse({ ...base, kind: 'AMOUNT', percentBps: 1000 }).success).toBe(false);
    expect(
      CreateCouponSchema.safeParse({
        ...base,
        kind: 'AMOUNT',
        amountMinor: 500,
        startsAt: '2026-10-05T00:00:00Z',
        endsAt: '2026-10-04T00:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('asks for a proven phone only when the rules depend on who the customer is', () => {
    const plain = { firstOrderOnly: false, referrerCustomerId: null, ownerCustomerId: null };
    expect(couponNeedsIdentity(plain)).toBe(false);
    expect(couponNeedsIdentity({ ...plain, firstOrderOnly: true })).toBe(true);
    expect(couponNeedsIdentity({ ...plain, referrerCustomerId: 'c1' })).toBe(true);
    expect(couponNeedsIdentity({ ...plain, ownerCustomerId: 'c1' })).toBe(true);
  });
});
