import { SubscriptionStatus } from './enums';
import {
  CORE_ENTITLEMENTS,
  DEFAULT_PLAN_EXCLUSIONS,
  ENTITLEMENT_KEYS,
  PLAN_MATRIX_KEYS,
  endOfUtcMonth,
  exclusionsFrom,
  graceUntil,
  moduleNeedsPlan,
  planFeaturesFrom,
  resolveEntitlements,
} from './entitlements';
import { FEATURE_KEYS } from './features';

const now = new Date('2026-10-05T12:00:00Z');

describe('entitlements', () => {
  it('lists every plan feature and module once', () => {
    expect(new Set(ENTITLEMENT_KEYS).size).toBe(ENTITLEMENT_KEYS.length);
    for (const key of FEATURE_KEYS) expect(ENTITLEMENT_KEYS).toContain(key);
    for (const key of CORE_ENTITLEMENTS) expect(PLAN_MATRIX_KEYS).not.toContain(key);
  });

  it('BASIC keeps everything needed to take orders and leaves out what was PRO only', () => {
    const basic = planFeaturesFrom(DEFAULT_PLAN_EXCLUSIONS.BASIC);
    for (const key of CORE_ENTITLEMENTS) expect(basic).toContain(key);
    for (const key of ['crm', 'campaigns', 'analytics', 'loyalty', 'coupons', 'custom_domain', 'api_access'] as const)
      expect(basic).not.toContain(key);
    expect(basic).toContain('kitchen_display');
    expect(planFeaturesFrom(DEFAULT_PLAN_EXCLUSIONS.PRO)).toEqual([...ENTITLEMENT_KEYS]);
  });

  it('stores exclusions, so a module unknown to a plan row is carried, and never excludes the core', () => {
    expect(planFeaturesFrom([])).toEqual([...ENTITLEMENT_KEYS]);
    expect(planFeaturesFrom(['orders', 'menu'])).toContain('orders');
    const features = planFeaturesFrom(['kitchen_display']);
    expect(features).not.toContain('kitchen_display');
    expect(exclusionsFrom(features)).toEqual(['kitchen_display']);
    expect(exclusionsFrom(['crm'])).not.toContain('orders');
  });

  it('adds running grants and drops lapsed ones', () => {
    const held = resolveEntitlements(
      ['menu'],
      [
        { key: 'crm', until: null },
        { key: 'campaigns', until: new Date('2026-10-06T00:00:00Z') },
        { key: 'loyalty', until: new Date('2026-10-04T00:00:00Z') },
        { key: 'not_a_key', until: null },
      ],
      now,
    );
    expect(held).toEqual(expect.arrayContaining([...CORE_ENTITLEMENTS, 'crm', 'campaigns']));
    expect(held).not.toContain('loyalty');
    expect(held).not.toContain('not_a_key' as never);
  });

  it('only plain modules are closed by the plan; plan features keep their own checks', () => {
    expect(moduleNeedsPlan('kitchen_display')).toBe(true);
    expect(moduleNeedsPlan('crm')).toBe(false);
    expect(moduleNeedsPlan('api_access')).toBe(false);
  });

  it('grace runs to the period end on a paid plan and to the month end on the free one', () => {
    const periodEnd = new Date('2026-10-20T00:00:00Z');
    const active = {
      planCode: 'PRO',
      status: SubscriptionStatus.ACTIVE,
      trialEndsAt: null,
      currentPeriodEnd: periodEnd,
    };
    expect(graceUntil(active, 'PRO', now)).toEqual(periodEnd);
    const trialEnd = new Date('2026-12-01T00:00:00Z');
    const trial = {
      planCode: 'PRO',
      status: SubscriptionStatus.TRIALING,
      trialEndsAt: trialEnd,
      currentPeriodEnd: null,
    };
    expect(graceUntil(trial, 'PRO', now)).toEqual(trialEnd);
    expect(graceUntil(null, 'BASIC', now)).toEqual(new Date('2026-11-01T00:00:00Z'));
    expect(graceUntil({ ...active, currentPeriodEnd: null }, 'PRO', now)).toEqual(endOfUtcMonth(now));
    expect(endOfUtcMonth(new Date('2026-12-31T23:59:59Z'))).toEqual(new Date('2027-01-01T00:00:00Z'));
  });
});
