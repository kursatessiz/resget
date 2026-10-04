import {
  DEFAULT_CONSENT_POLICY,
  UpdateConsentLimitsSchema,
  consentRegionOf,
  countryOfPhone,
  effectiveConsentChannels,
  evaluateCommercialEligibility,
  frequencyCapReached,
  needsDoubleOptIn,
} from './consent';
import type { ConsentPolicy, ConsentState } from './consent';

const granted = (extra: Partial<ConsentState> = {}): ConsentState => ({
  granted: true,
  legalBasis: 'CONSENT',
  confirmationRequestedAt: null,
  confirmedAt: null,
  ...extra,
});
const exemptOn: ConsentPolicy = { ...DEFAULT_CONSENT_POLICY, merchantExemption: true };

describe('consent regions', () => {
  it('reads the country from the calling code, longest prefix first', () => {
    expect(countryOfPhone('+905321112233')).toBe('TR');
    expect(countryOfPhone('+4915112345678')).toBe('DE');
    expect(countryOfPhone('+35312345678')).toBe('IE');
    expect(countryOfPhone('+12025550123')).toBe('US');
    expect(countryOfPhone('+97150123456')).toBeNull();
  });

  it('maps countries to rule regions', () => {
    expect(consentRegionOf('TR')).toBe('TR');
    expect(consentRegionOf('de')).toBe('EU_UK');
    expect(consentRegionOf('GB')).toBe('EU_UK');
    expect(consentRegionOf('CA')).toBe('NANP');
    expect(consentRegionOf('AE')).toBe('OTHER');
    expect(consentRegionOf(null)).toBe('OTHER');
  });
});

describe('commercial eligibility', () => {
  const base = { channel: 'SMS' as const, region: 'TR' as const, isBusiness: false, policy: DEFAULT_CONSENT_POLICY };

  it('lets an explicit consent through and stops without one', () => {
    expect(evaluateCommercialEligibility({ ...base, state: granted() })).toEqual({ eligible: true, basis: 'CONSENT' });
    expect(evaluateCommercialEligibility({ ...base, state: null })).toEqual({ eligible: false, reason: 'NO_CONSENT' });
  });

  it('lets a refusal win over everything, the exemption included', () => {
    const refused = granted({ granted: false });
    expect(evaluateCommercialEligibility({ ...base, state: refused })).toEqual({
      eligible: false,
      reason: 'OPTED_OUT',
    });
    expect(evaluateCommercialEligibility({ ...base, state: refused, isBusiness: true, policy: exemptOn })).toEqual({
      eligible: false,
      reason: 'OPTED_OUT',
    });
  });

  it('does not count a consent waiting for its confirmation link', () => {
    const waiting = granted({ confirmationRequestedAt: new Date() });
    expect(evaluateCommercialEligibility({ ...base, state: waiting })).toEqual({
      eligible: false,
      reason: 'CONSENT_UNCONFIRMED',
    });
    expect(evaluateCommercialEligibility({ ...base, state: { ...waiting, confirmedAt: new Date() } }).eligible).toBe(
      true,
    );
  });

  it('applies the merchant exemption only to Turkish businesses, on IYS channels, with the switch on', () => {
    const business = { ...base, isBusiness: true, state: null };
    expect(evaluateCommercialEligibility({ ...business, policy: exemptOn })).toEqual({
      eligible: true,
      basis: 'TR_MERCHANT_EXEMPTION',
    });
    expect(evaluateCommercialEligibility({ ...business, policy: DEFAULT_CONSENT_POLICY }).eligible).toBe(false);
    expect(evaluateCommercialEligibility({ ...business, policy: exemptOn, channel: 'WHATSAPP' }).eligible).toBe(false);
    expect(evaluateCommercialEligibility({ ...business, policy: exemptOn, region: 'EU_UK' }).eligible).toBe(false);
    expect(evaluateCommercialEligibility({ ...business, policy: exemptOn, isBusiness: false }).eligible).toBe(false);
  });

  it('stops counting a written exemption once the switch is off', () => {
    const exemption = granted({ legalBasis: 'TR_MERCHANT_EXEMPTION' });
    expect(
      evaluateCommercialEligibility({ ...base, isBusiness: true, state: exemption, policy: DEFAULT_CONSENT_POLICY }),
    ).toEqual({ eligible: false, reason: 'EXEMPTION_DISABLED' });
    expect(
      evaluateCommercialEligibility({ ...base, isBusiness: true, state: exemption, policy: exemptOn }).eligible,
    ).toBe(true);
  });

  it('lists the reachable channels from per-channel states', () => {
    expect(
      effectiveConsentChannels(
        { WHATSAPP: granted(), SMS: granted({ granted: false }) },
        { region: 'TR', isBusiness: false, policy: DEFAULT_CONSENT_POLICY },
      ),
    ).toEqual(['WHATSAPP']);
    expect(effectiveConsentChannels({}, { region: 'TR', isBusiness: true, policy: exemptOn }).sort()).toEqual([
      'CALL',
      'EMAIL',
      'SMS',
    ]);
  });
});

describe('double opt-in and caps', () => {
  it('asks for confirmation in the policy regions only', () => {
    expect(needsDoubleOptIn('EU_UK', DEFAULT_CONSENT_POLICY)).toBe(true);
    expect(needsDoubleOptIn('TR', DEFAULT_CONSENT_POLICY)).toBe(false);
    expect(needsDoubleOptIn('TR', { ...DEFAULT_CONSENT_POLICY, doubleOptInRegions: ['TR'] })).toBe(true);
  });

  it('stops at the daily or the weekly cap', () => {
    expect(frequencyCapReached(0, 0, DEFAULT_CONSENT_POLICY)).toBe(false);
    expect(frequencyCapReached(1, 1, DEFAULT_CONSENT_POLICY)).toBe(true);
    expect(frequencyCapReached(0, 3, DEFAULT_CONSENT_POLICY)).toBe(true);
    expect(frequencyCapReached(0, 2, DEFAULT_CONSENT_POLICY)).toBe(false);
  });

  it('keeps restaurant limits in range and the daily cap under the weekly one', () => {
    expect(UpdateConsentLimitsSchema.safeParse({ dailyCap: 2, weeklyCap: 5 }).success).toBe(true);
    expect(UpdateConsentLimitsSchema.safeParse({ dailyCap: 4, weeklyCap: 10 }).success).toBe(false);
    expect(UpdateConsentLimitsSchema.safeParse({ dailyCap: 3, weeklyCap: 2 }).success).toBe(false);
    expect(UpdateConsentLimitsSchema.safeParse({ dailyCap: 0, weeklyCap: 2 }).success).toBe(false);
  });
});
