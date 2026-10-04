import { z } from 'zod';
import { MinorAmountSchema } from './money';
import type { CouponKind } from './coupons';

/**
 * Customer referrals (docs/TAVSIYE.md, module referrals): a customer shares
 * a personal code; a friend who never ordered from the restaurant gets a
 * discount on the first order, and when that order completes the customer
 * receives a reward coupon only they can use. Both are restaurant-funded and
 * built on coupons (docs/KUPONLAR.md), so every coupon rule applies: one
 * discount per order, cancelled orders give their use back.
 */

/** Where a coupon came from; manual coupons are the ones the panel lists. */
export const COUPON_SOURCES = ['MANUAL', 'REFERRAL', 'REFERRAL_REWARD'] as const;
export type CouponSource = (typeof COUPON_SOURCES)[number];

export const REFERRAL_REWARD_STATUSES = ['GRANTED', 'SKIPPED_CAP'] as const;
export type ReferralRewardStatus = (typeof REFERRAL_REWARD_STATUSES)[number];

/** Window the per-referrer cap counts over. */
export const REFERRAL_CAP_WINDOW_DAYS = 30;

const ProgramRulesSchema = z.object({
  isActive: z.boolean(),
  /** Items total the friend's first order needs; 0 means none. */
  friendMinBasketMinor: MinorAmountSchema,
  /** The referrer's reward: an amount coupon only they can use. */
  rewardAmountMinor: z.number().int().min(1),
  rewardValidDays: z.number().int().min(7).max(365),
  /** Rewards one customer can earn in REFERRAL_CAP_WINDOW_DAYS; beyond it the friend still gets the discount. */
  monthlyCapPerReferrer: z.number().int().min(1).max(100),
});

/** The programme with the friend's offer: a percent (optionally capped) or a fixed amount off the first order. */
export const UpsertReferralProgramSchema = z.discriminatedUnion('friendKind', [
  ProgramRulesSchema.extend({
    friendKind: z.literal('PERCENT'),
    /** 1000 = 10 percent of the friend's first items total. */
    friendPercentBps: z.number().int().min(100).max(10_000),
    friendMaxDiscountMinor: z.number().int().min(1).nullable(),
  }).strict(),
  ProgramRulesSchema.extend({
    friendKind: z.literal('AMOUNT'),
    friendAmountMinor: z.number().int().min(1),
  }).strict(),
]);
export type UpsertReferralProgramInput = z.infer<typeof UpsertReferralProgramSchema>;

/** The friend's discount as coupon terms. */
export function friendCouponTerms(input: UpsertReferralProgramInput): {
  kind: CouponKind;
  percentBps: number | null;
  maxDiscountMinor: number | null;
  amountMinor: number | null;
  minBasketMinor: number;
} {
  return input.friendKind === 'PERCENT'
    ? {
        kind: 'PERCENT',
        percentBps: input.friendPercentBps,
        maxDiscountMinor: input.friendMaxDiscountMinor,
        amountMinor: null,
        minBasketMinor: input.friendMinBasketMinor,
      }
    : {
        kind: 'AMOUNT',
        percentBps: null,
        maxDiscountMinor: null,
        amountMinor: input.friendAmountMinor,
        minBasketMinor: input.friendMinBasketMinor,
      };
}

/** Letters and digits that cannot be misread (no 0/O, 1/I/L). */
export const REFERRAL_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * A code: a prefix letter and seven characters of the alphabet. `randomIndex`
 * returns a uniform integer in [0, max) (node:crypto randomInt in the API),
 * so every character is equally likely; no modulo over raw bytes.
 */
export function referralCodeFrom(randomIndex: (max: number) => number, prefix: 'R' | 'W' | 'P'): string {
  let code = prefix;
  for (let i = 0; i < 7; i++) code += REFERRAL_CODE_ALPHABET[randomIndex(REFERRAL_CODE_ALPHABET.length)];
  return code;
}

export interface ReferralProgramDTO {
  isActive: boolean;
  friendKind: CouponKind;
  friendPercentBps: number | null;
  friendMaxDiscountMinor: number | null;
  friendAmountMinor: number | null;
  friendMinBasketMinor: number;
  rewardAmountMinor: number;
  rewardValidDays: number;
  monthlyCapPerReferrer: number;
  currency: string;
  stats: {
    /** Personal codes customers have taken. */
    codes: number;
    /** First orders placed with a code that still count. */
    friendOrders: number;
    friendDiscountMinor: number;
    rewardsGranted: number;
    rewardsSkipped: number;
    rewardValueMinor: number;
    rewardsUsed: number;
  };
}

export interface MyReferralRewardDTO {
  code: string;
  amountMinor: number;
  endsAt: string | null;
  used: boolean;
}

/** One restaurant's programme as a customer sees it on their account page. */
export interface MyReferralDTO {
  restaurantId: string;
  slug: string;
  name: string;
  currency: string;
  /** Null until the customer asks for it. */
  code: string | null;
  friendKind: CouponKind;
  friendPercentBps: number | null;
  friendMaxDiscountMinor: number | null;
  friendAmountMinor: number | null;
  friendMinBasketMinor: number;
  rewardAmountMinor: number;
  rewardValidDays: number;
  rewards: MyReferralRewardDTO[];
}
