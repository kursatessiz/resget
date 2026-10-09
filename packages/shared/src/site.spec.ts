import {
  ROBOTS_DISALLOW,
  SiteBlockSchema,
  SitePagePathSchema,
  UpsertSitePageSchema,
  blogPostPath,
  blogPostingJsonLd,
  districtPath,
  markdownInline,
  siteEntryPath,
  faqJsonLd,
  placeSlug,
  restaurantJsonLd,
  serializeJsonLd,
  sitePagePath,
} from './site';

describe('page engine and SEO helpers', () => {
  it('turns place names into URL segments', () => {
    expect(placeSlug('Kadıköy')).toBe('kadikoy');
    expect(placeSlug('İstanbul')).toBe('istanbul');
    expect(placeSlug('Şişli Çağlayan')).toBe('sisli-caglayan');
    expect(placeSlug('Ümraniye / Ataşehir')).toBe('umraniye-atasehir');
    expect(placeSlug('  ')).toBe('bolge');
    expect(districtPath('İstanbul', 'Kadıköy')).toBe('/ilce/istanbul/kadikoy');
    expect(sitePagePath('en', 'guide/qr-menu')).toBe('/p/en/guide/qr-menu');
  });

  it('accepts lowercase paths of up to three parts only', () => {
    for (const ok of ['restoranlar-icin', 'rehber/qr-menu', 'a/b/c'])
      expect(SitePagePathSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['', 'Buyuk', 'a//b', '../admin', 'a/b/c/d', '-a', 'a-', 'a b'])
      expect(SitePagePathSchema.safeParse(bad).success).toBe(false);
  });

  it('allows site paths and https links only', () => {
    const cta = (href: string) => SiteBlockSchema.safeParse({ type: 'cta', heading: 'H', label: 'L', href }).success;
    expect(cta('/kayit')).toBe(true);
    expect(cta('https://ornek.test/a?b=1')).toBe(true);
    expect(cta('//evil.test')).toBe(false);
    expect(cta('http://ornek.test')).toBe(false);
    expect(cta('javascript:alert(1)')).toBe(false);
    expect(cta('https://ornek.test/"onmouseover')).toBe(false);
  });

  it('refuses unknown block fields and malformed districts', () => {
    expect(SiteBlockSchema.safeParse({ type: 'text', body: 'x', html: '<b>' }).success).toBe(false);
    expect(SiteBlockSchema.safeParse({ type: 'restaurants', area: 'TR|Istanbul|Kadikoy' }).success).toBe(true);
    expect(SiteBlockSchema.safeParse({ type: 'restaurants', area: 'Istanbul|Kadikoy' }).success).toBe(false);
  });

  it('defaults a new page to a draft and bounds search texts', () => {
    const base = {
      path: 'a',
      locale: 'tr',
      title: 'Başlık',
      description: 'Yeterince uzun açıklama',
      blocks: [{ type: 'text', body: 'x' }],
    };
    expect(UpsertSitePageSchema.parse(base).status).toBe('DRAFT');
    expect(UpsertSitePageSchema.safeParse({ ...base, title: 'x'.repeat(71) }).success).toBe(false);
    expect(UpsertSitePageSchema.safeParse({ ...base, description: 'x'.repeat(161) }).success).toBe(false);
    expect(UpsertSitePageSchema.safeParse({ ...base, blocks: [] }).success).toBe(false);
  });

  it('builds structured data and never lets text close the script tag', () => {
    const data = restaurantJsonLd(
      {
        slug: 's',
        name: 'Lokanta </script><script>x()</script>',
        logoUrl: null,
        defaultLocale: 'tr',
        address: { street: 'Cadde 1', district: 'Kadıköy', city: 'İstanbul', countryCode: 'TR', postalCode: null },
        customDomain: null,
        structuredData: true,
      },
      'https://ornek.test/s',
    );
    expect(data).toMatchObject({ '@type': 'Restaurant', address: { addressLocality: 'Kadıköy' } });
    expect(data).not.toHaveProperty('image');
    const json = serializeJsonLd(data);
    expect(json).not.toContain('<');
    expect(JSON.parse(json)).toEqual(data);
    expect(serializeJsonLd({ a: 'x y' })).toBe('{"a":"x\\u2028y"}');
    expect(faqJsonLd([{ question: 'Q', answer: 'A' }]).mainEntity).toEqual([
      { '@type': 'Question', name: 'Q', acceptedAnswer: { '@type': 'Answer', text: 'A' } },
    ]);
  });

  it('keeps panels and one-time links out of search engines', () => {
    expect(ROBOTS_DISALLOW).toEqual(
      expect.arrayContaining(['/panel', '/admin', '/pazarlama', '/t/', '/onay/', '/hesap/', '/*/grup/']),
    );
    // Table QR pages stay crawlable so their canonical link to the restaurant page can be read.
    expect(ROBOTS_DISALLOW).not.toContain('/m/');
  });

  it('places posts under /blog with a one-segment address', () => {
    expect(blogPostPath('tr', 'qr-menu')).toBe('/blog/tr/qr-menu');
    expect(siteEntryPath('POST', 'en', 'a')).toBe('/blog/en/a');
    expect(siteEntryPath('PAGE', 'en', 'a/b')).toBe('/p/en/a/b');
    const post = {
      path: 'qr-menu',
      locale: 'tr',
      title: 'Masa QR menü',
      description: 'Masa QR menü nasıl kurulur, adım adım.',
      blocks: [{ type: 'text', body: 'x' }],
      kind: 'POST',
    };
    expect(UpsertSitePageSchema.parse(post).kind).toBe('POST');
    expect(UpsertSitePageSchema.safeParse({ ...post, path: 'rehber/qr-menu' }).success).toBe(false);
    expect(UpsertSitePageSchema.safeParse({ ...post, kind: 'PAGE', path: 'rehber/qr-menu' }).success).toBe(true);
    expect(UpsertSitePageSchema.parse({ ...post, kind: undefined }).kind).toBe('PAGE');
  });

  it('describes a post for search engines with its author', () => {
    const data = blogPostingJsonLd(
      {
        title: 'T',
        description: 'D',
        locale: 'tr',
        publishedAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-02T00:00:00.000Z',
      },
      { name: 'Platform', isOrganization: true },
      'https://ornek.test/blog/tr/t',
    );
    expect(data).toMatchObject({
      '@type': 'BlogPosting',
      inLanguage: 'tr',
      datePublished: '2026-10-01T00:00:00.000Z',
      author: { '@type': 'Organization', name: 'Platform' },
    });
  });

  it('flattens tenant text for llms.txt so it cannot add links or headings', () => {
    expect(markdownInline('Başlık [tıkla](https://kotu.test)\n# H1')).toBe('Başlık tıklahttps://kotu.test H1');
    expect(markdownInline('  a\r\n\r\nb  ')).toBe('a b');
  });
});
