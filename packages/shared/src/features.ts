import { z } from 'zod';

/**
 * Module switches (docs/OZELLIK_ANAHTARLARI.md). Every product module has a
 * key here, and the platform owner turns it on or off from the console:
 * globally, and per restaurant for pilots or exceptions. A restaurant's own
 * setting wins over the global one; without either, the catalogue default
 * applies. Modules that already ran before the switches existed default to
 * on, new modules ship off and are opened when ready. Switches decide
 * whether a module exists for a restaurant; plans (plans.ts) still decide
 * what a BASIC or PRO restaurant may use, and permissions what a member may
 * do.
 */

export const FEATURE_GROUPS = ['ordering', 'payments', 'delivery', 'marketing', 'integrations'] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

/** How far along a module is: generally available, or open to pilots while it settles. */
export type FeatureStage = 'GA' | 'BETA';

export interface FeatureSpec {
  group: FeatureGroup;
  /** Applies when neither a global nor a restaurant switch is set. */
  defaultEnabled: boolean;
  stage: FeatureStage;
}

export const FEATURES = {
  marketplace: { group: 'ordering', defaultEnabled: true, stage: 'GA' },
  table_qr: { group: 'ordering', defaultEnabled: true, stage: 'GA' },
  ratings: { group: 'ordering', defaultEnabled: true, stage: 'GA' },
  missing_item_claims: { group: 'ordering', defaultEnabled: true, stage: 'GA' },
  claim_escalation: { group: 'ordering', defaultEnabled: false, stage: 'BETA' },
  app_order_handling: { group: 'ordering', defaultEnabled: false, stage: 'BETA' },
  order_availability: { group: 'ordering', defaultEnabled: false, stage: 'BETA' },
  online_payment: { group: 'payments', defaultEnabled: true, stage: 'GA' },
  meal_cards: { group: 'payments', defaultEnabled: true, stage: 'GA' },
  partial_refunds: { group: 'payments', defaultEnabled: true, stage: 'GA' },
  own_courier_dispatch: { group: 'delivery', defaultEnabled: true, stage: 'GA' },
  courier_network: { group: 'delivery', defaultEnabled: true, stage: 'GA' },
  delivery_zones: { group: 'delivery', defaultEnabled: false, stage: 'BETA' },
  crm: { group: 'marketing', defaultEnabled: true, stage: 'GA' },
  campaigns: { group: 'marketing', defaultEnabled: true, stage: 'GA' },
  loyalty: { group: 'marketing', defaultEnabled: true, stage: 'GA' },
  coupons: { group: 'marketing', defaultEnabled: false, stage: 'BETA' },
  whatsapp_channel: { group: 'marketing', defaultEnabled: true, stage: 'GA' },
  custom_domain: { group: 'integrations', defaultEnabled: true, stage: 'GA' },
  api_access: { group: 'integrations', defaultEnabled: true, stage: 'GA' },
} as const satisfies Record<string, FeatureSpec>;

export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];
export const FeatureKeySchema = z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]);

/** A switch as stored: on, off, or not set (null falls back to the next level). */
export const FeatureSwitchSchema = z.object({ enabled: z.boolean().nullable() }).strict();
export type FeatureSwitchInput = z.infer<typeof FeatureSwitchSchema>;

export interface FeatureSwitches {
  global: Partial<Record<FeatureKey, boolean>>;
  restaurant: Partial<Record<FeatureKey, boolean>>;
}

/** Restaurant switch, then global switch, then the catalogue default. */
export function isFeatureEnabled(key: FeatureKey, switches: FeatureSwitches): boolean {
  return switches.restaurant[key] ?? switches.global[key] ?? FEATURES[key].defaultEnabled;
}

/** Every key that is on for a restaurant (or for the platform as a whole when no restaurant switches are given). */
export function enabledFeatures(switches: FeatureSwitches): FeatureKey[] {
  return FEATURE_KEYS.filter((key) => isFeatureEnabled(key, switches));
}

/** The console's view of one module: catalogue facts, the global switch and the restaurants that differ. */
export interface AdminFeatureDTO {
  key: FeatureKey;
  group: FeatureGroup;
  stage: FeatureStage;
  defaultEnabled: boolean;
  /** The global switch; null when it follows the default. */
  global: boolean | null;
  /** On for the platform as a whole (global switch or default). */
  enabled: boolean;
  overrides: { restaurantId: string; restaurantName: string; slug: string; enabled: boolean }[];
}

/** One restaurant's view: what applies and whether it comes from the restaurant's own switch. */
export interface RestaurantFeatureDTO {
  key: FeatureKey;
  group: FeatureGroup;
  stage: FeatureStage;
  enabled: boolean;
  /** The restaurant's own switch; null when it follows the global one. */
  override: boolean | null;
}
