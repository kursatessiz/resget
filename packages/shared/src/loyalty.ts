import { z } from 'zod';
import { BasisPointsSchema, MinorAmountSchema, bpsOf } from './money';

/**
 * Loyalty program (docs/SADAKAT.md): a PRO feature (`loyalty`) the restaurant
 * configures itself. Points are earned when an order completes and spent as
 * a restaurant-funded discount at checkout. Every rule below is restaurant
 * data; the code holds only the arithmetic, which is integer-only so the
 * balance and the discount never drift.
 */

/** Bounds of a tier's earn multiplier, in percent of the base rule. */
export const LOYALTY_TIER_MULTIPLIER = { min: 100, max: 500 } as const;

/** A loyalty tier (docs/SADAKAT.md, "Seviyeler"): its name is restaurant data and never translated. */
export const LoyaltyTierSchema = z
  .object({
    name: z.string().trim().min(1).max(30),
    /** Lifetime spend at the restaurant (cancelled orders excluded) that reaches the tier, in minor units. */
    minSpendMinor: z.number().int().min(1).max(1_000_000_000_000),
    /** Points earned on an order are multiplied by this percentage (100 = as the base rule). */
    earnMultiplierPct: z.number().int().min(LOYALTY_TIER_MULTIPLIER.min).max(LOYALTY_TIER_MULTIPLIER.max),
  })
  .strict();
export type LoyaltyTier = z.infer<typeof LoyaltyTierSchema>;
export const LOYALTY_TIERS_MAX = 4;

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
    /** Tiers in rising order of spend; empty is a program without tiers. */
    tiers: z
      .array(LoyaltyTierSchema)
      .max(LOYALTY_TIERS_MAX)
      .default([])
      .refine((tiers) => tiers.every((tier, i) => i === 0 || tier.minSpendMinor > tiers[i - 1]!.minSpendMinor), {
        message: 'tiers must rise in spend',
      }),
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
  tiers: [],
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
  /** The customer's tier there and how much more spend reaches the next one; null without tiers. */
  tier: string | null;
  nextTier: { name: string; remainingMinor: number } | null;
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

export interface LoyaltyStanding {
  /** The highest tier whose threshold the spend reaches; null below the first. */
  current: LoyaltyTier | null;
  /** The next tier up and the spend still missing; null at the top or without tiers. */
  next: { tier: LoyaltyTier; remainingMinor: number } | null;
}

/** Where a customer stands among the restaurant's tiers, from their lifetime spend there. */
export function loyaltyTierFor(tiers: readonly LoyaltyTier[], lifetimeSpendMinor: number): LoyaltyStanding {
  let current: LoyaltyTier | null = null;
  for (const tier of tiers) if (lifetimeSpendMinor >= tier.minSpendMinor) current = tier;
  const upcoming = tiers.find((tier) => tier.minSpendMinor > lifetimeSpendMinor);
  return {
    current,
    next: upcoming ? { tier: upcoming, remainingMinor: upcoming.minSpendMinor - lifetimeSpendMinor } : null,
  };
}

/** Points a completed order earns at a tier: the base rule's points times the tier's percentage, whole points. */
export function tieredPointsEarned(rule: EarnRule, spendMinor: number, earnMultiplierPct: number): number {
  return Math.floor((pointsEarnedFor(rule, spendMinor) * earnMultiplierPct) / 100);
}
