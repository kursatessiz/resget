import { countHashtags, socialPostProblems, SocialPostInputSchema } from './social-publishing';

describe('countHashtags', () => {
  it('counts tags followed by a letter, digit or underscore, in any script', () => {
    expect(countHashtags('#lahmacun #2x1 #_yeni #çorba')).toBe(4);
    expect(countHashtags('fiyat # 10, son karakter #')).toBe(0);
    expect(countHashtags('##iki')).toBe(1);
  });
});

describe('socialPostProblems', () => {
  it('asks for an image only when an Instagram account is targeted', () => {
    expect(socialPostProblems({ body: 'Merhaba', hasImage: false, kinds: ['FACEBOOK_PAGE'] })).toEqual([]);
    expect(
      socialPostProblems({ body: 'Merhaba', hasImage: false, kinds: ['FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS'] }),
    ).toEqual(['INSTAGRAM_NEEDS_IMAGE']);
    expect(socialPostProblems({ body: 'Merhaba', hasImage: true, kinds: ['INSTAGRAM_BUSINESS'] })).toEqual([]);
  });

  it("applies Instagram's hashtag limit to Instagram posts only", () => {
    const body = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ');
    expect(socialPostProblems({ body, hasImage: true, kinds: ['INSTAGRAM_BUSINESS'] })).toEqual(['TOO_MANY_HASHTAGS']);
    expect(socialPostProblems({ body, hasImage: false, kinds: ['FACEBOOK_PAGE'] })).toEqual([]);
  });
});

describe('SocialPostInputSchema', () => {
  const id = '6f1c2f8e-5b1a-4c3e-9a2b-1d2e3f4a5b6c';
  it('refuses a repeated account and an empty body', () => {
    expect(SocialPostInputSchema.safeParse({ body: 'Selam', accountIds: [id, id] }).success).toBe(false);
    expect(SocialPostInputSchema.safeParse({ body: '   ', accountIds: [id] }).success).toBe(false);
    expect(SocialPostInputSchema.safeParse({ body: 'Selam', accountIds: [id] }).success).toBe(true);
  });
});
