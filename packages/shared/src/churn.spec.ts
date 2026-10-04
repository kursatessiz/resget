import { churnThresholds, customerChurnRisk, healthLevel, healthScore, restaurantSignals } from './churn';

const NOW = new Date('2026-10-01T12:00:00Z');
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000);

describe('customer churn risk', () => {
  it('has no class for a contact who never ordered', () => {
    expect(customerChurnRisk({ orderCount: 0, firstOrderAt: null, lastOrderAt: null }, NOW)).toBeNull();
  });

  it('moves a one-time customer from new to not returned to lost', () => {
    const one = (days: number) =>
      customerChurnRisk({ orderCount: 1, firstOrderAt: daysAgo(days), lastOrderAt: daysAgo(days) }, NOW);
    expect(one(10)).toBe('NEW');
    expect(one(30)).toBe('NEW');
    expect(one(31)).toBe('NOT_RETURNED');
    expect(one(90)).toBe('NOT_RETURNED');
    expect(one(91)).toBe('LOST');
  });

  it('judges a regular against their own rhythm', () => {
    // Weekly: five orders over 28 days, a 7-day rhythm; at risk after 14 quiet days, lost after 90.
    const weekly = (quiet: number) =>
      customerChurnRisk({ orderCount: 5, firstOrderAt: daysAgo(28 + quiet), lastOrderAt: daysAgo(quiet) }, NOW);
    expect(weekly(14)).toBe('ACTIVE');
    expect(weekly(15)).toBe('AT_RISK');
    expect(weekly(91)).toBe('LOST');

    // Monthly: four orders over 90 days; still active after 40 quiet days, at risk after 60, lost after 120.
    const monthly = { orderCount: 4, firstOrderAt: daysAgo(130), lastOrderAt: daysAgo(40) };
    expect(churnThresholds(monthly)).toEqual({ usualIntervalDays: 30, atRiskAfterDays: 60, lostAfterDays: 120 });
    expect(customerChurnRisk(monthly, NOW)).toBe('ACTIVE');
    expect(customerChurnRisk({ ...monthly, firstOrderAt: daysAgo(151), lastOrderAt: daysAgo(61) }, NOW)).toBe(
      'AT_RISK',
    );
    expect(customerChurnRisk({ ...monthly, firstOrderAt: daysAgo(211), lastOrderAt: daysAgo(121) }, NOW)).toBe('LOST');
  });

  it('treats several orders on the same day as a one-day rhythm', () => {
    const sameDay = { orderCount: 3, firstOrderAt: daysAgo(20), lastOrderAt: daysAgo(20) };
    expect(churnThresholds(sameDay).usualIntervalDays).toBe(1);
    expect(customerChurnRisk(sameDay, NOW)).toBe('AT_RISK');
  });
});

describe('restaurant health signals', () => {
  const base = {
    createdAt: daysAgo(200),
    lastOrderAt: daysAgo(1),
    ordersLastWindow: 40,
    ordersPreviousWindow: 42,
    hasOverdueInvoice: false,
    listingSuspended: false,
    trialEndsAt: null,
    hasBillingCard: false,
  };

  it('finds nothing wrong with a steady restaurant', () => {
    expect(restaurantSignals(base, NOW)).toEqual([]);
    expect(healthLevel([])).toBeNull();
  });

  it('flags silence, a halved order count and no first order', () => {
    expect(restaurantSignals({ ...base, lastOrderAt: daysAgo(7) }, NOW)).toEqual(['SILENT']);
    expect(restaurantSignals({ ...base, ordersLastWindow: 21 }, NOW)).toEqual(['ORDER_DROP']);
    expect(restaurantSignals({ ...base, ordersLastWindow: 22 }, NOW)).toEqual([]);
    expect(restaurantSignals({ ...base, ordersLastWindow: 2, ordersPreviousWindow: 9 }, NOW)).toEqual([]);
    expect(restaurantSignals({ ...base, lastOrderAt: null, createdAt: daysAgo(14) }, NOW)).toEqual(['NEVER_ORDERED']);
    expect(restaurantSignals({ ...base, lastOrderAt: null, createdAt: daysAgo(13) }, NOW)).toEqual([]);
  });

  it('flags billing trouble and a trial ending without a card', () => {
    expect(restaurantSignals({ ...base, hasOverdueInvoice: true, listingSuspended: true }, NOW)).toEqual([
      'PAYMENT_OVERDUE',
      'LISTING_SUSPENDED',
    ]);
    const trial = { ...base, trialEndsAt: daysAgo(-5) };
    expect(restaurantSignals(trial, NOW)).toEqual(['TRIAL_ENDING']);
    expect(restaurantSignals({ ...trial, hasBillingCard: true }, NOW)).toEqual([]);
    expect(restaurantSignals({ ...base, trialEndsAt: daysAgo(-8) }, NOW)).toEqual([]);
    expect(restaurantSignals({ ...base, trialEndsAt: daysAgo(1) }, NOW)).toEqual([]);
  });

  it('weighs the signals into a level', () => {
    expect(healthScore(['SILENT', 'TRIAL_ENDING'])).toBe(4);
    expect(healthLevel(['SILENT'])).toBe('HIGH');
    expect(healthLevel(['ORDER_DROP'])).toBe('MEDIUM');
    expect(healthLevel(['TRIAL_ENDING'])).toBe('LOW');
  });
});
