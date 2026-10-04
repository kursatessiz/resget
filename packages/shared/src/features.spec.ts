import { FEATURES, FEATURE_KEYS, FeatureSwitchSchema, enabledFeatures, isFeatureEnabled } from './features';
import { PANEL_NAV, visibleNav } from './navigation';
import { PERMISSION_KEYS } from './permissions';

describe('module switches', () => {
  it('lets the restaurant switch win over the global one, and the global one over the default', () => {
    expect(isFeatureEnabled('loyalty', { global: {}, restaurant: {} })).toBe(FEATURES.loyalty.defaultEnabled);
    expect(isFeatureEnabled('loyalty', { global: { loyalty: false }, restaurant: {} })).toBe(false);
    expect(isFeatureEnabled('loyalty', { global: { loyalty: false }, restaurant: { loyalty: true } })).toBe(true);
    expect(isFeatureEnabled('loyalty', { global: { loyalty: true }, restaurant: { loyalty: false } })).toBe(false);
  });

  it('lists the modules that are on, in catalogue order', () => {
    expect(enabledFeatures({ global: {}, restaurant: {} })).toEqual(
      FEATURE_KEYS.filter((key) => FEATURES[key].defaultEnabled),
    );
    expect(enabledFeatures({ global: { campaigns: false }, restaurant: {} })).not.toContain('campaigns');
  });

  it('accepts on, off and null (follow the next level) only', () => {
    expect(FeatureSwitchSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(FeatureSwitchSchema.safeParse({ enabled: null }).success).toBe(true);
    expect(FeatureSwitchSchema.safeParse({}).success).toBe(false);
    expect(FeatureSwitchSchema.safeParse({ enabled: 'yes' }).success).toBe(false);
  });

  it('hides a panel screen while its module is off', () => {
    const everyone = [...PERMISSION_KEYS];
    const all = visibleNav(everyone, FEATURE_KEYS).map((i) => i.key);
    expect(all).toEqual(PANEL_NAV.map((i) => i.key));
    const withoutLoyalty = visibleNav(
      everyone,
      FEATURE_KEYS.filter((key) => key !== 'loyalty'),
    ).map((i) => i.key);
    expect(withoutLoyalty).not.toContain('loyalty');
    expect(withoutLoyalty).toContain('orders');
  });
});
