import { contentSecurityPolicy, tileSources } from './csp';

describe('contentSecurityPolicy', () => {
  it('limits images to the app, data images, the upload origin, the allowlist and the tile provider', () => {
    const csp = contentSecurityPolicy({
      imagePolicy: { uploadOrigin: 'https://api.resget.test', allowedHosts: ['cdn.example.test'] },
      tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    });
    expect(csp).toBe(
      "img-src 'self' data: https://api.resget.test https://cdn.example.test https://tile.openstreetmap.org; " +
        "object-src 'none'; base-uri 'self'",
    );
    // Scripts are not restricted further than today, so Next.js bootstrap scripts keep running.
    expect(csp).not.toContain('script-src');
    expect(csp).not.toContain('default-src');
  });

  it('reads the origin of a tile template, with a leading subdomain placeholder as a wildcard', () => {
    expect(tileSources('https://{s}.tile.example.test/{z}/{x}/{y}.png')).toEqual(['https://*.tile.example.test']);
    expect(tileSources('https://tiles.example.test:8443/{z}/{x}/{y}.png?key=abc')).toEqual([
      'https://tiles.example.test:8443',
    ]);
    expect(tileSources('https://a{s}.example.test/{z}.png')).toEqual(['https:']);
    expect(tileSources('not a url')).toEqual([]);
  });

  it('keeps a development upload origin on http', () => {
    const csp = contentSecurityPolicy({
      imagePolicy: { uploadOrigin: 'http://localhost:4000', allowedHosts: [] },
      tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    });
    expect(csp.split('; ')[0]).toBe("img-src 'self' data: http://localhost:4000 https://tile.openstreetmap.org");
  });
});
