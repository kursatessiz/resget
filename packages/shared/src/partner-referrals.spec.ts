import { PartnerCodeSchema, UpdatePartnerReferralConfigSchema, proExtension } from './partner-referrals';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-04T12:00:00.000Z');
const at = (days: number) => new Date(now.getTime() + days * DAY);

describe('restaurant referrals', () => {
  it('lengthens a running trial', () => {
    expect(
      proExtension({ planCode: 'PRO', status: 'TRIALING', trialEndsAt: at(10), currentPeriodEnd: null }, 30, now),
    ).toEqual({ kind: 'TRIAL', trialEndsAt: at(40) });
  });

  it('moves a paid or grace period end, so the next renewal moves too', () => {
    for (const status of ['ACTIVE', 'PAST_DUE', 'CANCELLED'] as const) {
      expect(proExtension({ planCode: 'PRO', status, trialEndsAt: null, currentPeriodEnd: at(5) }, 30, now)).toEqual({
        kind: 'PERIOD',
        currentPeriodEnd: at(35),
      });
    }
  });

  it('leaves an open-ended paid PRO alone', () => {
    expect(
      proExtension({ planCode: 'PRO', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null }, 30, now),
    ).toEqual({
      kind: 'UNCHANGED',
    });
  });

  it('starts a PRO trial from now for BASIC, an ended trial or an ended period', () => {
    const fresh = { kind: 'RESTART_TRIAL', trialEndsAt: at(30) };
    expect(
      proExtension({ planCode: 'BASIC', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null }, 30, now),
    ).toEqual(fresh);
    expect(
      proExtension({ planCode: 'PRO', status: 'TRIALING', trialEndsAt: at(-1), currentPeriodEnd: null }, 30, now),
    ).toEqual(fresh);
    expect(
      proExtension({ planCode: 'PRO', status: 'CANCELLED', trialEndsAt: null, currentPeriodEnd: at(-3) }, 30, now),
    ).toEqual(fresh);
    expect(proExtension(null, 30, now)).toEqual(fresh);
  });

  it('reads partner codes case-insensitively and refuses anything else', () => {
    expect(PartnerCodeSchema.parse('p2345xyz')).toBe('P2345XYZ');
    for (const bad of ['R2345XYZ', 'P2345XY', 'P2345XY0', 'P2345XYI', ''])
      expect(PartnerCodeSchema.safeParse(bad).success).toBe(false);
  });

  it('bounds the console settings', () => {
    const base = {
      isActive: true,
      referrerRewardDays: 30,
      refereeBonusDays: 30,
      qualifyingOrders: 10,
      yearlyCapPerReferrer: 12,
    };
    expect(UpdatePartnerReferralConfigSchema.safeParse(base).success).toBe(true);
    expect(UpdatePartnerReferralConfigSchema.safeParse({ ...base, qualifyingOrders: 0 }).success).toBe(false);
    expect(UpdatePartnerReferralConfigSchema.safeParse({ ...base, referrerRewardDays: 400 }).success).toBe(false);
  });
});
