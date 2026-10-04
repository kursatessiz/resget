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
 * Plans and their prices are platform data (Plan table); this file holds the
 * fixed vocabulary and the rules that decide what a subscription unlocks.
 */
export const PLAN_CODES = ['BASIC', 'PRO'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];
export const PlanCodeSchema = z.enum(PLAN_CODES);

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

export const PLAN_FEATURE_SETS: Readonly<Record<PlanCode, readonly PlanFeature[]>> = {
  BASIC: ['menu', 'orders', 'table_qr', 'marketplace', 'own_ordering_page'],
  PRO: [...PLAN_FEATURES],
};

/** Days of PRO every new restaurant gets before falling back to BASIC. A platform setting; this is the default. */
export const PRO_TRIAL_DAYS_DEFAULT = 90;

export interface SubscriptionLike {
  planCode: PlanCode;
  status: SubscriptionStatus;
  trialEndsAt: Date | string | null;
  currentPeriodEnd: Date | string | null;
}

/** The plan whose features apply right now. A lapsed trial or a cancelled PRO behaves as BASIC. */
export function effectivePlan(subscription: SubscriptionLike | null | undefined, now: Date = new Date()): PlanCode {
  if (!subscription || subscription.planCode === 'BASIC') return 'BASIC';
  switch (subscription.status) {
    case SubscriptionStatus.ACTIVE:
      return 'PRO';
    case SubscriptionStatus.TRIALING:
      return subscription.trialEndsAt && new Date(subscription.trialEndsAt).getTime() > now.getTime() ? 'PRO' : 'BASIC';
    case SubscriptionStatus.PAST_DUE:
      // Grace: features stay until the paid period ends, then BASIC.
      return subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd).getTime() > now.getTime()
        ? 'PRO'
        : 'BASIC';
    case SubscriptionStatus.CANCELLED:
      return subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd).getTime() > now.getTime()
        ? 'PRO'
        : 'BASIC';
    default:
      return 'BASIC';
  }
}

export function hasFeature(
  subscription: SubscriptionLike | null | undefined,
  feature: PlanFeature,
  now: Date = new Date(),
): boolean {
  return PLAN_FEATURE_SETS[effectivePlan(subscription, now)].includes(feature);
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
