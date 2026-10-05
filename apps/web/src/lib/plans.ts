import { PLAN_FEATURES, isBuiltInPlan } from '@resget/shared';
import type { EntitlementKey, Translate } from '@resget/shared';

/**
 * Plans are data (docs/PLAN_MATRISI.md): the built-in ones have translated
 * names, a plan the platform owner added shows the name written for it.
 */
export function planLabel(t: Translate, code: string, name: string): string {
  return isBuiltInPlan(code) ? t(`plans.${code}.name`) : name;
}

/** The panel's "Temel plan" / "Pro plan" form, with the same fallback. */
export function panelPlanLabel(t: Translate, code: string, name: string): string {
  return isBuiltInPlan(code) ? t(`panel.plan.${code}`) : name;
}

/** A plan matrix row: plan features have their own names, modules the catalogue's. */
export function entitlementLabel(t: Translate, key: EntitlementKey): string {
  return (PLAN_FEATURES as readonly string[]).includes(key) ? t(`plans.feature.${key}`) : t(`features.${key}.name`);
}
