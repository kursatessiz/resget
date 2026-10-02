import { SubscriptionStatus } from './enums';
import {
  PLAN_FEATURE_SETS,
  PRO_TRIAL_DAYS_DEFAULT,
  debitCredits,
  effectivePlan,
  hasFeature,
  trialEndFrom,
} from './plans';

const now = new Date('2026-10-02T12:00:00Z');
const tomorrow = new Date('2026-10-03T12:00:00Z');
const yesterday = new Date('2026-10-01T12:00:00Z');

describe('plans', () => {
  it('BASIC keeps everything a restaurant needs to take orders', () => {
    for (const f of ['menu', 'orders', 'table_qr', 'marketplace', 'own_ordering_page'] as const) {
      expect(PLAN_FEATURE_SETS.BASIC).toContain(f);
    }
    expect(PLAN_FEATURE_SETS.BASIC).not.toContain('campaigns');
  });

  it('a running PRO trial unlocks PRO, a lapsed one falls back to BASIC', () => {
    const trial = { planCode: 'PRO' as const, status: SubscriptionStatus.TRIALING, currentPeriodEnd: null };
    expect(effectivePlan({ ...trial, trialEndsAt: tomorrow }, now)).toBe('PRO');
    expect(effectivePlan({ ...trial, trialEndsAt: yesterday }, now)).toBe('BASIC');
    expect(hasFeature({ ...trial, trialEndsAt: yesterday }, 'orders', now)).toBe(true);
    expect(hasFeature({ ...trial, trialEndsAt: yesterday }, 'crm', now)).toBe(false);
  });

  it('past due and cancelled keep PRO until the paid period ends', () => {
    for (const status of [SubscriptionStatus.PAST_DUE, SubscriptionStatus.CANCELLED]) {
      expect(effectivePlan({ planCode: 'PRO', status, trialEndsAt: null, currentPeriodEnd: tomorrow }, now)).toBe(
        'PRO',
      );
      expect(effectivePlan({ planCode: 'PRO', status, trialEndsAt: null, currentPeriodEnd: yesterday }, now)).toBe(
        'BASIC',
      );
    }
    expect(effectivePlan(null, now)).toBe('BASIC');
  });

  it('computes the trial end from the default length', () => {
    expect(trialEndFrom(now).getTime() - now.getTime()).toBe(PRO_TRIAL_DAYS_DEFAULT * 86400000);
  });

  it('never debits a wallet below zero', () => {
    expect(debitCredits(10, 3)).toEqual({ ok: true, balanceAfter: 7 });
    expect(debitCredits(2, 3)).toEqual({ ok: false, balanceAfter: 2 });
    expect(() => debitCredits(2, -1)).toThrow(RangeError);
  });
});
