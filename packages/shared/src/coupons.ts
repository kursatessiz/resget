import { z } from 'zod';
import { MinorAmountSchema, bpsOf } from './money';

/**
 * Coupons and promo codes (docs/KUPONLAR.md): a restaurant-funded discount
 * the customer unlocks with a code at checkout. A PRO feature (`coupons`)
 * behind the coupons module switch. Every rule is restaurant data; the code
 * holds only the arithmetic and the checks, both integer-only. One discount
 * per order: a coupon is not combined with loyalty points.
 */

export const COUPON_KINDS = ['PERCENT', 'AMOUNT'] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

/** Codes are upper case letters, digits and dashes; what the customer types is upper-cased first. */
export const CouponCodeSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,23}$/, 'Code: 3-24 letters, digits or dashes'));

const CouponRulesSchema = z
  .object({
    code: CouponCodeSchema,
    /** Items total (before the delivery fee) the order needs; 0 means none. */
    minBasketMinor: MinorAmountSchema,
    /** Only a phone that never ordered from this restaurant before. */
    firstOrderOnly: z.boolean(),
    /** Uses per customer phone; cancelled orders give their use back. */
    perCustomerLimit: z.number().int().min(1).max(100),
    /** Uses in total; null means no ceiling. */
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable(),
    startsAt: z.string().datetime().nullable(),
    endsAt: z.string().datetime().nullable(),
  })
  .strict();

export const CreateCouponSchema = z
  .discriminatedUnion('kind', [
    CouponRulesSchema.extend({
      kind: z.literal('PERCENT'),
      /** 1000 = 10 percent of the items total. */
      percentBps: z.number().int().min(100).max(10_000),
      /** Ceiling of the percent discount; null means none. */
      maxDiscountMinor: z.number().int().min(1).nullable(),
    }).strict(),
    CouponRulesSchema.extend({
      kind: z.literal('AMOUNT'),
      amountMinor: z.number().int().min(1),
    }).strict(),
  ])
  .refine((v) => !v.startsAt || !v.endsAt || new Date(v.startsAt) < new Date(v.endsAt), {
    message: 'The coupon ends after it starts',
    path: ['endsAt'],
  });
export type CreateCouponInput = z.infer<typeof CreateCouponSchema>;

/** Pausing or reopening a coupon; its rules stay as they were when customers saw them. */
export const UpdateCouponSchema = z.object({ isActive: z.boolean() }).strict();
export type UpdateCouponInput = z.infer<typeof UpdateCouponSchema>;

/** The parts of a coupon the arithmetic and the checks read. */
export interface CouponTerms {
  kind: CouponKind;
  percentBps: number | null;
  maxDiscountMinor: number | null;
  amountMinor: number | null;
  minBasketMinor: number;
  firstOrderOnly: boolean;
  perCustomerLimit: number;
  maxRedemptions: number | null;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  isActive: boolean;
}

/** The discount on an items total, never more than the total itself. */
export function couponDiscountMinor(
  coupon: Pick<CouponTerms, 'kind' | 'percentBps' | 'maxDiscountMinor' | 'amountMinor'>,
  itemsGrossMinor: number,
): number {
  const raw =
    coupon.kind === 'PERCENT'
      ? Math.min(bpsOf(itemsGrossMinor, coupon.percentBps ?? 0), coupon.maxDiscountMinor ?? Number.MAX_SAFE_INTEGER)
      : (coupon.amountMinor ?? 0);
  return Math.max(0, Math.min(raw, itemsGrossMinor));
}

/**
 * Whether a coupon's rules depend on who the customer is: first order only, a
 * personal referral code (its owner may not use it) or a reward coupon that
 * belongs to one customer. Such a coupon is used only on an order placed by a
 * signed-in customer for their own phone (COUPON_SIGN_IN_REQUIRED); a typed
 * phone proves nothing. A plain coupon stays usable anonymously; its
 * per-customer limit is then counted on the typed phone (docs/KUPONLAR.md).
 */
export function couponNeedsIdentity(coupon: {
  firstOrderOnly: boolean;
  referrerCustomerId: string | null;
  ownerCustomerId: string | null;
}): boolean {
  return coupon.firstOrderOnly || coupon.referrerCustomerId !== null || coupon.ownerCustomerId !== null;
}

export type CouponRefusal =
  | 'COUPON_NOT_FOUND'
  | 'COUPON_EXPIRED'
  | 'COUPON_MIN_BASKET'
  | 'COUPON_FIRST_ORDER_ONLY'
  | 'COUPON_LIMIT_REACHED'
  | 'COUPON_ALREADY_USED';

/** Why a coupon does not apply to this order, or null when it does. */
export function couponRefusal(
  coupon: CouponTerms,
  context: {
    now: Date;
    itemsGrossMinor: number;
    /** Earlier orders of this phone at the restaurant. */
    customerOrderCount: number;
    /** Uses of this coupon by this phone that still count (not given back). */
    customerRedemptions: number;
    totalRedemptions: number;
  },
): CouponRefusal | null {
  if (!coupon.isActive) return 'COUPON_NOT_FOUND';
  const now = context.now.getTime();
  if (coupon.startsAt && now < new Date(coupon.startsAt).getTime()) return 'COUPON_NOT_FOUND';
  if (coupon.endsAt && now >= new Date(coupon.endsAt).getTime()) return 'COUPON_EXPIRED';
  if (coupon.maxRedemptions !== null && context.totalRedemptions >= coupon.maxRedemptions)
    return 'COUPON_LIMIT_REACHED';
  if (coupon.firstOrderOnly && context.customerOrderCount > 0) return 'COUPON_FIRST_ORDER_ONLY';
  if (context.customerRedemptions >= coupon.perCustomerLimit) return 'COUPON_ALREADY_USED';
  if (coupon.minBasketMinor > 0 && context.itemsGrossMinor < coupon.minBasketMinor) return 'COUPON_MIN_BASKET';
  return null;
}

export interface CouponDTO {
  id: string;
  code: string;
  kind: CouponKind;
  percentBps: number | null;
  maxDiscountMinor: number | null;
  amountMinor: number | null;
  minBasketMinor: number;
  firstOrderOnly: boolean;
  perCustomerLimit: number;
  maxRedemptions: number | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  /** Uses that still count (cancelled orders gave theirs back). */
  redemptionCount: number;
  /** What the restaurant has given away with it so far, on orders that still count. */
  discountTotalMinor: number;
  currency: string;
  createdAt: string;
}

/** What the menu page learns about a code the customer typed: enough to preview the discount. */
export interface PublicCouponDTO {
  code: string;
  kind: CouponKind;
  percentBps: number | null;
  maxDiscountMinor: number | null;
  amountMinor: number | null;
  minBasketMinor: number;
  firstOrderOnly: boolean;
  currency: string;
}
