import { ImageHostAllowlistSchema, ImageUrlSchema, imageSources, imageUrlAllowed } from './image-url';
import { UpdateMenuItemSchema } from './menu';
import { UpdateRestaurantSettingsSchema } from './restaurant';

/** A URL carrying credentials, built at run time so secret scanners do not read the fixture as a leaked secret. */
const withCredentials = (user: string, password: string, rest: string): string =>
  `https://${user}:${password}` + '@' + rest;

describe('image links', () => {
  const policy = { uploadOrigin: 'https://api.resget.test', allowedHosts: ['cdn.example.test'] };

  it('accepts https without credentials and http only on a loopback host', () => {
    expect(ImageUrlSchema.safeParse('https://cdn.example.test/logo.png').success).toBe(true);
    expect(ImageUrlSchema.safeParse('http://localhost:4000/uploads/logos/x.png').success).toBe(true);
    for (const value of [
      'http://cdn.example.test/logo.png',
      withCredentials('user', 'secret', 'cdn.example.test/logo.png'),
      'https://user@cdn.example.test/logo.png',
      'ftp://cdn.example.test/logo.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      `https://cdn.example.test/${'a'.repeat(500)}`,
    ]) {
      expect({ value, ok: ImageUrlSchema.safeParse(value).success }).toEqual({ value, ok: false });
    }
  });

  it('is the rule of the logo and menu image fields', () => {
    expect(UpdateRestaurantSettingsSchema.safeParse({ logoUrl: 'http://tracker.example.test/p.gif' }).success).toBe(
      false,
    );
    expect(UpdateRestaurantSettingsSchema.safeParse({ logoUrl: null }).success).toBe(true);
    expect(
      UpdateMenuItemSchema.safeParse({ imageUrl: withCredentials('a', 'b', 'cdn.example.test/x.png') }).success,
    ).toBe(false);
    expect(UpdateMenuItemSchema.safeParse({ imageUrl: 'https://cdn.example.test/x.png' }).success).toBe(true);
  });

  it('allows the upload origin and allowlisted hosts on the default port only', () => {
    expect(imageUrlAllowed('https://api.resget.test/uploads/logos/r/x.png', policy)).toBe(true);
    expect(imageUrlAllowed('https://cdn.example.test/logo.png', policy)).toBe(true);
    expect(imageUrlAllowed('https://CDN.example.test/logo.png', policy)).toBe(true);
    expect(imageUrlAllowed('https://cdn.example.test:8443/logo.png', policy)).toBe(false);
    expect(imageUrlAllowed('https://tracker.example.test/p.gif', policy)).toBe(false);
    expect(imageUrlAllowed('https://cdn.example.test.tracker.test/p.gif', policy)).toBe(false);
    expect(imageUrlAllowed('https://sub.cdn.example.test/p.gif', policy)).toBe(false);
    expect(imageUrlAllowed(withCredentials('u', 'p', 'cdn.example.test/logo.png'), policy)).toBe(false);
    // A development API on http is its own upload origin.
    const dev = { uploadOrigin: 'http://localhost:4000', allowedHosts: [] };
    expect(imageUrlAllowed('http://localhost:4000/uploads/logos/r/x.png', dev)).toBe(true);
    expect(imageUrlAllowed('http://localhost:5000/x.png', dev)).toBe(false);
  });

  it('parses the allowlist and lists the CSP sources', () => {
    expect(ImageHostAllowlistSchema.parse(' CDN.example.test , img.example.test,')).toEqual([
      'cdn.example.test',
      'img.example.test',
    ]);
    expect(ImageHostAllowlistSchema.parse(undefined)).toEqual([]);
    expect(ImageHostAllowlistSchema.safeParse('https://cdn.example.test').success).toBe(false);
    expect(ImageHostAllowlistSchema.safeParse('*.example.test').success).toBe(false);
    expect(imageSources(policy)).toEqual(['https://api.resget.test', 'https://cdn.example.test']);
    expect(imageSources({ uploadOrigin: 'http://localhost:4000/', allowedHosts: [] })).toEqual([
      'http://localhost:4000',
    ]);
  });
});
