import { z } from 'zod';
import { BasisPointsSchema, MinorAmountSchema, bpsOf } from './money';

/**
 * Loyalty program (docs/SADAKAT.md): a PRO feature (`loyalty`) the restaurant
 * configures itself. Points are earned when an order completes and spent as
 * a restaurant-funded discount at checkout. Every rule below is restaurant
 * data; the code holds only the arithmetic, which is integer-only so the
 * balance and the discount never drift.
 */

export const LoyaltyProgramSchema = z
  .object({
    enabled: z.boolean(),
    /** Points earned per `earnStepMinor` of items spend (after the loyalty discount itself). */
    earnPoints: z.number().int().min(1).max(1000),
    /** Spend step, in minor units of the restaurant's currency, that earns `earnPoints`. */
    earnStepMinor: z.number().int().min(1).max(1_000_000),
    /** Points that convert into `redeemValueMinor` of discount. */
    redeemPoints: z.number().int().min(1).max(1_000_000),
    redeemValueMinor: z.number().int().min(1).max(100_000_000),
    /** Items total an order needs before points can be spent on it. */
    minOrderMinor: MinorAmountSchema,
    /** Ceiling of the discount as a share of the items total; the remaining points stay in the balance. */
    maxDiscountBps: BasisPointsSchema.refine((v) => v > 0, { message: 'maxDiscountBps must be positive' }),
    /** One-time bonus the first completed order brings. */
    welcomePoints: z.number().int().min(0).max(1_000_000),
    /** Tell the customer about points earned on a completed order; a paid message unless a push reaches them. */
    notifyEarned: z.boolean().default(false),
  })
  .strict();
export type LoyaltyProgram = z.infer<typeof LoyaltyProgramSchema>;

/** The program a restaurant starts with when it opens the screen: off, one point per spend step, ten percent back. */
export const LOYALTY_PROGRAM_DEFAULTS: Readonly<
  Omit<LoyaltyProgram, 'earnStepMinor' | 'redeemValueMinor' | 'minOrderMinor'>
> = {
  enabled: false,
  earnPoints: 1,
  redeemPoints: 100,
  maxDiscountBps: 5000,
  welcomePoints: 0,
  notifyEarned: false,
};

export const UpdateLoyaltyProgramSchema = LoyaltyProgramSchema;

export const LOYALTY_TRANSACTION_TYPES = ['EARN', 'WELCOME', 'REDEEM', 'REVERSAL', 'ADJUSTMENT'] as const;
export type LoyaltyTransactionType = (typeof LOYALTY_TRANSACTION_TYPES)[number];

export const AdjustLoyaltySchema = z
  .object({
    points: z
      .number()
      .int()
      .min(-1_000_000)
      .max(1_000_000)
      .refine((v) => v !== 0, { message: 'points must not be zero' }),
    memo: z.string().trim().min(1).max(200),
  })
  .strict();
export type AdjustLoyaltyInput = z.infer<typeof AdjustLoyaltySchema>;

export interface LoyaltyProgramDTO extends LoyaltyProgram {
  currency: string;
  /** Enabled and the plan carries the feature; only then do orders earn and spend. */
  active: boolean;
}

export interface LoyaltyStatsDTO {
  /** Customers holding a positive balance. */
  members: number;
  pointsOutstanding: number;
  pointsEarned: number;
  pointsRedeemed: number;
  /** Discount the program funded so far, in the restaurant's currency. */
  discountGivenMinor: number;
  currency: string;
}

export interface LoyaltyTransactionDTO {
  id: string;
  type: LoyaltyTransactionType;
  points: number;
  balanceAfter: number;
  orderShortCode: string | null;
  memo: string | null;
  customer: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface LoyaltyOverviewDTO {
  program: LoyaltyProgramDTO;
  stats: LoyaltyStatsDTO;
  recent: LoyaltyTransactionDTO[];
}

export interface CustomerLoyaltyDTO {
  points: number;
  transactions: LoyaltyTransactionDTO[];
}

/** The rules the storefront shows and computes the preview with; null when the program is not active. */
export interface StorefrontLoyaltyDTO {
  earnPoints: number;
  earnStepMinor: number;
  redeemPoints: number;
  redeemValueMinor: number;
  minOrderMinor: number;
  maxDiscountBps: number;
}

/** A customer's balance at one restaurant, as the account page lists them. */
export interface LoyaltyBalanceDTO {
  restaurant: { name: string; slug: string; logoUrl: string | null };
  points: number;
  /** What the balance is worth today under the restaurant's rule, or 0 when the program is off. */
  valueMinor: number;
  currency: string;
}

type EarnRule = Pick<LoyaltyProgram, 'earnPoints' | 'earnStepMinor'>;
type RedeemRule = Pick<LoyaltyProgram, 'redeemPoints' | 'redeemValueMinor' | 'minOrderMinor' | 'maxDiscountBps'>;

/** Points a completed order earns on its items spend; whole steps only. */
export function pointsEarnedFor(rule: EarnRule, spendMinor: number): number {
  if (!Number.isInteger(spendMinor) || spendMinor <= 0) return 0;
  return Math.floor(spendMinor / rule.earnStepMinor) * rule.earnPoints;
}

export interface LoyaltyRedemption {
  points: number;
  discountMinor: number;
}

/**
 * How much of a balance an order can spend: whole redemption steps, capped
 * by the discount ceiling and by the items total, nothing below the minimum
 * order. The remainder stays in the balance.
 */
export function redeemableFor(rule: RedeemRule, balance: number, itemsGrossMinor: number): LoyaltyRedemption {
  const none = { points: 0, discountMinor: 0 };
  if (!Number.isInteger(balance) || balance < rule.redeemPoints) return none;
  if (itemsGrossMinor <= 0 || itemsGrossMinor < rule.minOrderMinor) return none;
  const cap = Math.min(itemsGrossMinor, bpsOf(itemsGrossMinor, rule.maxDiscountBps));
  const steps = Math.min(Math.floor(balance / rule.redeemPoints), Math.floor(cap / rule.redeemValueMinor));
  if (steps <= 0) return none;
  return { points: steps * rule.redeemPoints, discountMinor: steps * rule.redeemValueMinor };
}

/** The value of a balance under the rule, ignoring any order: what the account page shows. */
export function balanceValueMinor(
  rule: Pick<LoyaltyProgram, 'redeemPoints' | 'redeemValueMinor'>,
  balance: number,
): number {
  if (!Number.isInteger(balance) || balance < rule.redeemPoints) return 0;
  return Math.floor(balance / rule.redeemPoints) * rule.redeemValueMinor;
}
