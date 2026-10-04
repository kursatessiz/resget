import { ReviewUrlSchema, UpdateFeedbackSettingsSchema, isLowRating, npsCategory, npsScore } from './feedback';

describe('feedback routing and NPS', () => {
  it('buckets NPS answers the standard way', () => {
    expect([0, 6, 7, 8, 9, 10].map(npsCategory)).toEqual([
      'DETRACTOR',
      'DETRACTOR',
      'PASSIVE',
      'PASSIVE',
      'PROMOTER',
      'PROMOTER',
    ]);
  });

  it('computes NPS as percent promoters minus percent detractors', () => {
    expect(npsScore({ promoters: 0, passives: 0, detractors: 0 })).toBeNull();
    expect(npsScore({ promoters: 5, passives: 3, detractors: 2 })).toBe(30);
    expect(npsScore({ promoters: 0, passives: 0, detractors: 4 })).toBe(-100);
    expect(npsScore({ promoters: 1, passives: 1, detractors: 1 })).toBe(0);
    expect(npsScore({ promoters: 2, passives: 1, detractors: 0 })).toBe(67);
  });

  it('opens a case at or below the threshold only', () => {
    expect(isLowRating(2, 2)).toBe(true);
    expect(isLowRating(3, 2)).toBe(false);
  });

  it('accepts only https review pages without credentials', () => {
    expect(ReviewUrlSchema.safeParse('https://g.page/r/abc123/review').success).toBe(true);
    for (const bad of ['http://g.page/r/abc', 'javascript:alert(1)', 'https://user:pw@evil.test/', 'https://a@b.test'])
      expect(ReviewUrlSchema.safeParse(bad).success).toBe(false);
  });

  it('keeps the alert threshold below the top scores', () => {
    const base = { reviewUrl: null, npsEnabled: true };
    expect(UpdateFeedbackSettingsSchema.safeParse({ ...base, alertMaxScore: 3 }).success).toBe(true);
    expect(UpdateFeedbackSettingsSchema.safeParse({ ...base, alertMaxScore: 4 }).success).toBe(false);
    expect(UpdateFeedbackSettingsSchema.safeParse({ ...base, alertMaxScore: 0 }).success).toBe(false);
  });
});
