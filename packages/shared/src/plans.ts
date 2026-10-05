import { z } from 'zod';
import { SubscriptionStatus } from './enums';
import { CurrencyCodeSchema, MinorAmountSchema } from './money';

/**
 * Restaurant SaaS tiers (docs/FIYATLANDIRMA.md).
 *
 * BASIC is free for as long as the restaurant exists: menu, order taking,
 * table QR and the 1 percent marketplace. There is no clock on it, so the
 * "free period" never produces a cliff where the restaurant has to decide
 * whether to keep paying for the thing that takes its orders.
 *
 * PRO is the paid layer (CRM, campaigns, analytics, loyalty, own ordering
 * page on a custom domain). New restaurants get PRO free for a trial period;
 * when it ends they fall back to BASIC and lose nothing they need to operate.
 *
 * Plans are platform data (Plan table): code, name, price, trial length and
 * the list of features each one carries (entitlements.ts). A new plan is a
 * new row, not a code change. Two codes are built in because the product
 * leans on them: BASIC is the free fallback every restaurant lands on, and
 * PRO is the plan new restaurants trial.
 */
export const BUILT_IN_PLAN_CODES = ['BASIC', 'PRO'] as const;
export type BuiltInPlanCode = (typeof BUILT_IN_PLAN_CODES)[number];
/** Every restaurant without a running paid plan behaves as this one. */
export const FALLBACK_PLAN_CODE: BuiltInPlanCode = 'BASIC';
/** The plan a new restaurant trials (docs/FIYATLANDIRMA.md). */
export const TRIAL_PLAN_CODE: BuiltInPlanCode = 'PRO';

/** A plan code is data: upper case letters, digits and underscores. */
export type PlanCode = string;
export const PlanCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,23}$/);

export function isBuiltInPlan(code: string): code is BuiltInPlanCode {
  return (BUILT_IN_PLAN_CODES as readonly string[]).includes(code);
}

/**
 * Features the plan matrix speaks of that are not modules of their own in
 * the switch catalogue. Keys shared with the catalogue (crm, campaigns,
 * loyalty, coupons, custom_domain, api_access, marketplace, table_qr) mean
 * the same thing on both sides.
 */
export const PLAN_FEATURES = [
  'menu',
  'orders',
  'table_qr',
  'marketplace',
  'own_ordering_page',
  'crm',
  'campaigns',
  'analytics',
  'loyalty',
  'coupons',
  'custom_domain',
  'api_access',
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

/** Days of PRO every new restaurant gets before falling back to BASIC. A platform setting; this is the default. */
export const PRO_TRIAL_DAYS_DEFAULT = 90;

export interface SubscriptionLike {
  planCode: PlanCode;
  status: SubscriptionStatus | `${SubscriptionStatus}`;
  trialEndsAt: Date | string | null;
  currentPeriodEnd: Date | string | null;
}

/**
 * Whether the subscribed plan applies right now. A lapsed trial, or a past
 * due or cancelled plan after its paid period, no longer does: the
 * restaurant then behaves as the fallback plan.
 */
export function subscriptionRunning(subscription: SubscriptionLike, now: Date = new Date()): boolean {
  const after = (at: Date | string | null) => at !== null && new Date(at).getTime() > now.getTime();
  switch (subscription.status) {
    case SubscriptionStatus.ACTIVE:
      return true;
    case SubscriptionStatus.TRIALING:
      return after(subscription.trialEndsAt);
    case SubscriptionStatus.PAST_DUE:
    case SubscriptionStatus.CANCELLED:
      // Grace: features stay until the paid period ends.
      return after(subscription.currentPeriodEnd);
    default:
      return false;
  }
}

/** The plan whose features apply right now. */
export function effectivePlan(
  subscription: SubscriptionLike | null | undefined,
  now: Date = new Date(),
  fallbackCode: PlanCode = FALLBACK_PLAN_CODE,
): PlanCode {
  if (!subscription || subscription.planCode === fallbackCode) return fallbackCode;
  return subscriptionRunning(subscription, now) ? subscription.planCode : fallbackCode;
}

export function trialEndFrom(startedAt: Date, trialDays: number = PRO_TRIAL_DAYS_DEFAULT): Date {
  return new Date(startedAt.getTime() + trialDays * 24 * 60 * 60 * 1000);
}

// -- Message credits ------------------------------------------------------------

/**
 * Channels that cost the platform real money per message and are therefore
 * sold as prepaid credit packages, separate from every plan. Push and email
 * are not metered. A credit is debited only when the provider accepted the
 * message (status SENT); a failed send costs nothing.
 */
export const CREDIT_CHANNELS = ['SMS', 'WHATSAPP'] as const;
export type CreditChannel = (typeof CREDIT_CHANNELS)[number];

export const MessageCreditPackageSchema = z
  .object({
    code: z.string().regex(/^[a-z0-9-]{3,40}$/),
    channel: z.enum(CREDIT_CHANNELS),
    credits: z.number().int().positive(),
    priceMinor: MinorAmountSchema,
    currency: CurrencyCodeSchema,
  })
  .strict();
export type MessageCreditPackage = z.infer<typeof MessageCreditPackageSchema>;

/** Small welcome balance so a new restaurant can try messaging; everything after that is bought. */
export const WELCOME_MESSAGE_CREDITS_DEFAULT: Readonly<Record<CreditChannel, number>> = { SMS: 25, WHATSAPP: 25 };

export interface CreditDebit {
  ok: boolean;
  balanceAfter: number;
}

/** A wallet never goes negative: an insufficient balance refuses the send instead of debiting. */
export function debitCredits(balance: number, cost: number): CreditDebit {
  if (!Number.isInteger(balance) || !Number.isInteger(cost) || cost < 0)
    throw new RangeError('credits are non-negative integers');
  if (cost > balance) return { ok: false, balanceAfter: balance };
  return { ok: true, balanceAfter: balance - cost };
}
