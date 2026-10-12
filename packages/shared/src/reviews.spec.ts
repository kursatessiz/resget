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

  it('signs with nothing when the name is not name-shaped, so the page shows the anonymous label', () => {
    // Link-like, contact-like or digit-heavy first words never reach the public author slot.
    expect(reviewAuthorName('www.example.test Y')).toBeNull();
    expect(reviewAuthorName('https://spam.example/x Ali')).toBeNull();
    expect(reviewAuthorName('spam.example Ali')).toBeNull();
    expect(reviewAuthorName('ali@example.com Veli')).toBeNull();
    expect(reviewAuthorName('05321112233 Kaya')).toBeNull();
    expect(reviewAuthorName('Ali2024 Kaya')).toBeNull();
    expect(reviewAuthorName('+905321112233')).toBeNull();
    expect(reviewAuthorName('A'.repeat(41))).toBeNull();
    // A last word that is not a name leaves only the first name, never its first character.
    expect(reviewAuthorName('Ayse 0532')).toBe('Ayse');
    expect(reviewAuthorName('Ayse www.x.test')).toBe('Ayse');
    // Real names keep working, accents, apostrophes and hyphens included.
    expect(reviewAuthorName('Şule Öztürk', 'tr')).toBe('Şule Ö.');
    expect(reviewAuthorName("D'Angelo Rossi")).toBe("D'Angelo R.");
    expect(reviewAuthorName('Anne-Marie Dupont')).toBe('Anne-Marie D.');
    expect(reviewAuthorName('José Álvarez')).toBe('José Á.');
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
