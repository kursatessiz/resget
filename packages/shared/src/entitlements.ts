import { z } from 'zod';
import { FEATURE_KEYS } from './features';
import type { FeatureKey } from './features';
import { FALLBACK_PLAN_CODE, PLAN_FEATURES, PlanCodeSchema, subscriptionRunning } from './plans';
import type { BuiltInPlanCode, PlanCode, PlanFeature, SubscriptionLike } from './plans';
import { CurrencyCodeSchema, MinorAmountSchema } from './money';

/**
 * Plan entitlements (docs/PLAN_MATRISI.md). Every plan row carries the list
 * of keys it unlocks: plan features (PLAN_FEATURES) and modules of the
 * switch catalogue (features.ts). What a restaurant may use is its effective
 * plan's list, plus two kinds of per-restaurant grants:
 *
 * - GRACE: written when the platform owner takes a key out of a plan, so a
 *   restaurant keeps it until the end of the period it is in (the paid
 *   period or the trial; for the free fallback plan, the end of the UTC
 *   month).
 * - EXCEPTION: the platform owner's "plan dışı açık" for one restaurant,
 *   open ended or until a date.
 *
 * A module still needs its switch on (features.ts); the plan decides
 * whether the restaurant's tier carries it, the switch whether it exists.
 */
export type EntitlementKey = PlanFeature | FeatureKey;

export const ENTITLEMENT_KEYS: readonly EntitlementKey[] = [
  ...PLAN_FEATURES,
  ...FEATURE_KEYS.filter((key) => !(PLAN_FEATURES as readonly string[]).includes(key)),
];
export const EntitlementKeySchema = z.enum(ENTITLEMENT_KEYS as [EntitlementKey, ...EntitlementKey[]]);

export function isEntitlementKey(key: string): key is EntitlementKey {
  return (ENTITLEMENT_KEYS as readonly string[]).includes(key);
}

/**
 * What a restaurant needs to take orders. Every plan carries these and the
 * matrix does not offer them: BASIC never loses anything needed to operate.
 */
export const CORE_ENTITLEMENTS: readonly EntitlementKey[] = [
  'menu',
  'orders',
  'table_qr',
  'marketplace',
  'own_ordering_page',
];

/** The keys the console's matrix shows, in catalogue order. */
export const PLAN_MATRIX_KEYS: readonly EntitlementKey[] = ENTITLEMENT_KEYS.filter(
  (key) => !CORE_ENTITLEMENTS.includes(key),
);

/** Plan features that were PRO only before plans became data. */
const PRO_ONLY: readonly EntitlementKey[] = PLAN_FEATURES.filter((key) => !CORE_ENTITLEMENTS.includes(key));

/**
 * A plan row stores what it leaves out, so a module added to the catalogue
 * later is in every plan and only its switch decides. These turn the stored
 * exclusions into the positive list the console and the checks use, and
 * back; the core is never excluded.
 */
export function planFeaturesFrom(excluded: readonly string[]): EntitlementKey[] {
  return ENTITLEMENT_KEYS.filter((key) => CORE_ENTITLEMENTS.includes(key) || !excluded.includes(key));
}

export function exclusionsFrom(features: readonly string[]): EntitlementKey[] {
  return PLAN_MATRIX_KEYS.filter((key) => !features.includes(key));
}

/** What the built-in plans leave out: BASIC the PRO features, PRO nothing. */
export const DEFAULT_PLAN_EXCLUSIONS: Readonly<Record<BuiltInPlanCode, readonly EntitlementKey[]>> = {
  BASIC: PRO_ONLY,
  PRO: [],
};

/**
 * Plan features keep the gating they had before plans became data: the
 * handlers and services that check them decide what a restaurant without
 * the feature still sees (a read-only list, an upsell). Every other key is
 * a plain module, and a module the plan does not carry is closed like a
 * switched-off one.
 */
export function moduleNeedsPlan(key: FeatureKey): boolean {
  return !(PLAN_FEATURES as readonly string[]).includes(key);
}

export const ENTITLEMENT_SOURCES = ['GRACE', 'EXCEPTION'] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

export interface EntitlementGrant {
  key: string;
  /** Null means open ended. */
  until: Date | string | null;
}

/** The effective plan's keys, the core and every grant still running, deduplicated and in catalogue order. */
export function resolveEntitlements(
  planFeatures: readonly string[],
  grants: readonly EntitlementGrant[],
  now: Date = new Date(),
): EntitlementKey[] {
  const held = new Set<string>([...CORE_ENTITLEMENTS, ...planFeatures]);
  for (const grant of grants) {
    if (grant.until === null || new Date(grant.until).getTime() > now.getTime()) held.add(grant.key);
  }
  return ENTITLEMENT_KEYS.filter((key) => held.has(key));
}

/** The first instant of the next UTC month. */
export function endOfUtcMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * How long a restaurant keeps a key taken out of the plan it is on: to the
 * end of its paid period or trial, and to the end of the UTC month on the
 * fallback plan or when the subscription names no period end.
 */
export function graceUntil(
  subscription: SubscriptionLike | null,
  effectiveCode: PlanCode,
  now: Date = new Date(),
  fallbackCode: PlanCode = FALLBACK_PLAN_CODE,
): Date {
  const monthEnd = endOfUtcMonth(now);
  if (effectiveCode === fallbackCode || !subscription || !subscriptionRunning(subscription, now)) return monthEnd;
  const end = subscription.status === 'TRIALING' ? subscription.trialEndsAt : subscription.currentPeriodEnd;
  return end ? new Date(end) : monthEnd;
}

// -- Console -------------------------------------------------------------------

export const PlanFeatureListSchema = z
  .array(EntitlementKeySchema)
  .max(ENTITLEMENT_KEYS.length)
  .transform((keys) => [...new Set(keys)]);

export const CreatePlanSchema = z
  .object({
    code: PlanCodeSchema,
    name: z.string().trim().min(2).max(80),
    monthlyPriceMinor: MinorAmountSchema,
    currency: CurrencyCodeSchema,
    trialDays: z.number().int().min(0).max(365).default(0),
    features: PlanFeatureListSchema.default([]),
  })
  .strict();
export type CreatePlanInput = z.infer<typeof CreatePlanSchema>;

export const SetPlanFeaturesSchema = z.object({ features: PlanFeatureListSchema }).strict();
export type SetPlanFeaturesInput = z.infer<typeof SetPlanFeaturesSchema>;

/** What a plan change did: keys added and removed, and how many restaurants keep a removed key to period end. */
export interface PlanFeaturesChangeDTO {
  added: EntitlementKey[];
  removed: EntitlementKey[];
  graceGranted: number;
}

export const CreateEntitlementExceptionSchema = z
  .object({
    key: EntitlementKeySchema,
    until: z.string().datetime({ offset: true }).nullable().default(null),
    note: z.string().trim().max(300).nullable().default(null),
  })
  .strict();
export type CreateEntitlementExceptionInput = z.infer<typeof CreateEntitlementExceptionSchema>;

/**
 * The console puts a restaurant on a plan until a self-serve payment flow
 * exists: active from now, with an optional paid period end. The change
 * applies at once; it writes no grace (it is the platform owner's own call).
 */
export const AssignPlanSchema = z
  .object({
    planId: z.string().uuid(),
    currentPeriodEnd: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict();
export type AssignPlanInput = z.infer<typeof AssignPlanSchema>;

export interface RestaurantEntitlementDTO {
  id: string;
  key: EntitlementKey;
  source: EntitlementSource;
  until: string | null;
  note: string | null;
  createdAt: string;
}

/** The console's per-restaurant view: the plan in force, what it carries, and the grants on top. */
export interface RestaurantEntitlementsDTO {
  planCode: PlanCode;
  planName: string;
  planFeatures: EntitlementKey[];
  entitlements: EntitlementKey[];
  grants: RestaurantEntitlementDTO[];
}
