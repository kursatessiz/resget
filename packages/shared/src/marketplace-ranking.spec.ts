import { dampedRating, rankRestaurants, rankingScore } from './marketplace-ranking';
import { isOpenAt, localClock } from './opening-hours';

describe('opening hours', () => {
  const hours = { mon: [['10:00', '23:00']], fri: [['18:00', '02:00']], sun: [] };

  it('reads the local clock in the zone and decides open or closed', () => {
    // Monday 2026-10-05 12:00 UTC is 15:00 in Istanbul.
    const monday = new Date('2026-10-05T12:00:00Z');
    expect(localClock(monday, 'Europe/Istanbul')).toEqual({ day: 'mon', minutes: 15 * 60 });
    expect(isOpenAt(hours, monday, 'Europe/Istanbul')).toBe(true);
    // 23:30 local: closed.
    expect(isOpenAt(hours, new Date('2026-10-05T20:30:00Z'), 'Europe/Istanbul')).toBe(false);
    // Sunday: no windows, closed.
    expect(isOpenAt(hours, new Date('2026-10-04T12:00:00Z'), 'Europe/Istanbul')).toBe(false);
  });

  it('lets a window spill past midnight into the next day', () => {
    // Friday 2026-10-09 23:00 local (20:00 UTC): open; Saturday 01:30 local: still open; 02:30: closed.
    expect(isOpenAt(hours, new Date('2026-10-09T20:00:00Z'), 'Europe/Istanbul')).toBe(true);
    expect(isOpenAt(hours, new Date('2026-10-09T22:30:00Z'), 'Europe/Istanbul')).toBe(true);
    expect(isOpenAt(hours, new Date('2026-10-09T23:30:00Z'), 'Europe/Istanbul')).toBe(false);
  });

  it('returns null for missing or malformed hours', () => {
    expect(isOpenAt(null, new Date(), 'Europe/Istanbul')).toBeNull();
    expect(isOpenAt({ mon: [['25:00', '26:00']] }, new Date(), 'Europe/Istanbul')).toBeNull();
  });
});

describe('marketplace ranking', () => {
  it('damps a young rating towards the prior and lets a large count speak for itself', () => {
    expect(dampedRating(0, 0)).toBe(4);
    expect(dampedRating(5, 1)).toBeCloseTo(25 / 6, 5);
    expect(dampedRating(500, 100)).toBeCloseTo(4.95, 2);
  });

  it('orders open first, then score, then name', () => {
    const ranked = rankRestaurants([
      { name: 'Zeytin', isOpenNow: true, ratingSum: 0, ratingCount: 0, recentOrders: 0 },
      { name: 'Asma', isOpenNow: true, ratingSum: 0, ratingCount: 0, recentOrders: 0 },
      { name: 'Kapali', isOpenNow: false, ratingSum: 50, ratingCount: 10, recentOrders: 100 },
      { name: 'Populer', isOpenNow: null, ratingSum: 45, ratingCount: 10, recentOrders: 40 },
    ]);
    expect(ranked.map((r) => r.name)).toEqual(['Populer', 'Asma', 'Zeytin', 'Kapali']);
    expect(rankingScore({ ratingSum: 45, ratingCount: 10, recentOrders: 40 })).toBeGreaterThan(
      rankingScore({ ratingSum: 0, ratingCount: 0, recentOrders: 0 }),
    );
  });
});
