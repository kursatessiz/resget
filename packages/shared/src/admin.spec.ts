import { RestaurantSignupSchema, slugify } from './admin';

describe('slugify', () => {
  it('transliterates Turkish letters and collapses separators', () => {
    expect(slugify('Çınaraltı Köfte & Izgara')).toBe('cinaralti-kofte-izgara');
    expect(slugify('  Şişli   Börekçisi ')).toBe('sisli-borekcisi');
    expect(slugify('İstanbul Ğ')).toBe('istanbul-g');
    expect(slugify('!!!')).toBe('isletme');
  });
});

describe('RestaurantSignupSchema', () => {
  it('accepts a known time zone and rejects an unknown one', () => {
    const base = {
      name: 'Deneme',
      countryCode: 'TR',
      currency: 'TRY',
      branch: { addressLine: 'Sokak No 1', city: 'Istanbul', district: 'Kadikoy' },
    };
    expect(RestaurantSignupSchema.safeParse({ ...base, timezone: 'Europe/Istanbul' }).success).toBe(true);
    expect(RestaurantSignupSchema.safeParse({ ...base, timezone: 'Mars/Olympus' }).success).toBe(false);
  });
});
