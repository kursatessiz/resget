import { editableUntil, reviewAuthorName, scrubReviewText, withinEditWindow } from './reviews';

describe('public reviews', () => {
  it('signs a review with the first name and the last initial', () => {
    expect(reviewAuthorName('Ayse Yilmaz')).toBe('Ayse Y.');
    expect(reviewAuthorName('  Mehmet  Ali   kaya ')).toBe('Mehmet K.');
    expect(reviewAuthorName('Cem')).toBe('Cem');
    expect(reviewAuthorName('')).toBeNull();
    expect(reviewAuthorName(null)).toBeNull();
    expect(reviewAuthorName('Deniz ilhan', 'tr')).toBe('Deniz İ.');
    expect(reviewAuthorName('Deniz ilhan', 'en')).toBe('Deniz I.');
  });

  it('masks phones, emails and links in public text', () => {
    const out = scrubReviewText('Harika! Beni 0532 111 22 33 ara, ali@example.com veya https://spam.example/x bak');
    expect(out).not.toContain('0532');
    expect(out).not.toContain('ali@example.com');
    expect(out).not.toContain('spam.example');
    expect(out.startsWith('Harika!')).toBe(true);
    expect(scrubReviewText('Kofte 10 numara')).toBe('Kofte 10 numara');
  });

  it('keeps edits open for one day', () => {
    const written = new Date('2026-10-05T10:00:00Z');
    expect(withinEditWindow(written, new Date('2026-10-06T09:59:00Z'))).toBe(true);
    expect(withinEditWindow(written, new Date('2026-10-06T10:01:00Z'))).toBe(false);
    expect(editableUntil(written).toISOString()).toBe('2026-10-06T10:00:00.000Z');
  });
});
