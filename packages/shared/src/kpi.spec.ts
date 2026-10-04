import { KpiQuerySchema, funnelStepRates, ordersPerRestaurantPerDay } from './kpi';

describe('kpi helpers', () => {
  it('computes orders per active restaurant per day to two decimals', () => {
    expect(ordersPerRestaurantPerDay(90, 3, 30)).toBe(1);
    expect(ordersPerRestaurantPerDay(100, 3, 7)).toBe(4.76);
    expect(ordersPerRestaurantPerDay(10, 0, 30)).toBe(0);
  });

  it('gives each funnel step its share of the previous one', () => {
    expect(funnelStepRates([{ count: 200 }, { count: 50 }, { count: 10 }, { count: 0 }, { count: 0 }])).toEqual([
      null,
      2500,
      2000,
      0,
      null,
    ]);
  });

  it('accepts only the supported ranges', () => {
    expect(KpiQuerySchema.parse({}).days).toBe(30);
    expect(KpiQuerySchema.parse({ days: '7' }).days).toBe(7);
    expect(KpiQuerySchema.safeParse({ days: '14' }).success).toBe(false);
  });
});
