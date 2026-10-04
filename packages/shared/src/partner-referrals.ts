import { z } from 'zod';
import { REFERRAL_CODE_ALPHABET } from './referrals';
import type { PlanCode } from './plans';

/**
 * Restaurant-to-restaurant referrals (docs/RESTORAN_TAVSIYE.md, module
 * partner_referrals): a restaurant shares its partner code; a restaurant
 * that signs up with it gets extra PRO days at once, and once it has
 * completed enough orders the referrer gets PRO days too. Rewards are PRO
 * time only: commission and settlement are never touched. Amounts are
 * platform data the console sets.
 */

export const PARTNER_REFERRAL_STATUSES = ['PENDING', 'REWARDED', 'CAPPED'] as const;
export type PartnerReferralStatus = (typeof PARTNER_REFERRAL_STATUSES)[number];

/** The window the referrer's cap counts over. */
export const PARTNER_REFERRAL_CAP_WINDOW_DAYS = 365;

/** `P` and seven characters of the referral alphabet; what is typed is upper-cased first. */
export const PartnerCodeSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  // The alphabet is letters and digits only, safe inside a character class.
  .pipe(z.string().regex(new RegExp(`^P[${REFERRAL_CODE_ALPHABET}]{7}$`)));

export const UpdatePartnerReferralConfigSchema = z
  .object({
    isActive: z.boolean(),
    /** PRO days the referrer earns per qualified restaurant. */
    referrerRewardDays: z.number().int().min(0).max(365),
    /** Extra PRO days the new restaurant gets at sign-up. */
    refereeBonusDays: z.number().int().min(0).max(365),
    /** Completed orders the new restaurant needs before the referrer is rewarded. */
    qualifyingOrders: z.number().int().min(1).max(1000),
    /** Rewards one referrer can earn in PARTNER_REFERRAL_CAP_WINDOW_DAYS. */
    yearlyCapPerReferrer: z.number().int().min(1).max(100),
  })
  .strict();
export type UpdatePartnerReferralConfigInput = z.infer<typeof UpdatePartnerReferralConfigSchema>;

export interface PartnerReferralConfigDTO extends UpdatePartnerReferralConfigInput {
  updatedAt: string | null;
}

export interface SubscriptionState {
  planCode: PlanCode;
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

/** How PRO days land on a subscription. */
export type ProExtension =
  /** Already PRO with no end date (an open-ended paid subscription): nothing to add. */
  | { kind: 'UNCHANGED' }
  /** A running trial is longer. */
  | { kind: 'TRIAL'; trialEndsAt: Date }
  /** A paid or grace period ends later, so the next renewal moves too. */
  | { kind: 'PERIOD'; currentPeriodEnd: Date }
  /** BASIC (or an ended PRO): becomes a PRO trial from now. */
  | { kind: 'RESTART_TRIAL'; trialEndsAt: Date };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Adds PRO days to a subscription without ever shortening it. */
export function proExtension(state: SubscriptionState | null, days: number, now: Date): ProExtension {
  const plus = (from: Date) => new Date(from.getTime() + days * DAY_MS);
  const future = (d: Date | null): d is Date => d !== null && d.getTime() > now.getTime();
  if (state && state.planCode === 'PRO') {
    if (state.status === 'TRIALING' && future(state.trialEndsAt))
      return { kind: 'TRIAL', trialEndsAt: plus(state.trialEndsAt) };
    if (state.status !== 'TRIALING' && future(state.currentPeriodEnd)) {
      return { kind: 'PERIOD', currentPeriodEnd: plus(state.currentPeriodEnd) };
    }
    if (state.status === 'ACTIVE' && state.currentPeriodEnd === null) return { kind: 'UNCHANGED' };
  }
  return { kind: 'RESTART_TRIAL', trialEndsAt: plus(now) };
}

export interface PartnerReferralRowDTO {
  restaurantName: string;
  createdAt: string;
  status: PartnerReferralStatus;
  completedOrders: number;
  rewardedAt: string | null;
  rewardDays: number | null;
}

/** The referrer's view on its plan page. */
export interface MyPartnerReferralsDTO {
  /** The programme runs (console setting); codes are made and honoured only then. */
  isActive: boolean;
  /** Null until the restaurant asks for it. */
  code: string | null;
  referrerRewardDays: number;
  refereeBonusDays: number;
  qualifyingOrders: number;
  rewardDaysEarned: number;
  referrals: PartnerReferralRowDTO[];
}

/** What the sign-up page shows for an invite link. */
export interface PartnerInviteDTO {
  restaurantName: string;
  refereeBonusDays: number;
}

export interface AdminPartnerReferralDTO {
  referrer: { id: string; name: string; slug: string };
  referee: { id: string; name: string; slug: string };
  status: PartnerReferralStatus;
  refereeBonusDays: number;
  rewardDays: number | null;
  completedOrders: number;
  createdAt: string;
  rewardedAt: string | null;
}
