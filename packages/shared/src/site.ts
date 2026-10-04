import { z } from 'zod';
import { LocaleCodeSchema } from './i18n/locales';

/**
 * Page engine and technical SEO (docs/SAYFA_MOTORU.md, module page_engine):
 * the platform's own pages built from a small set of blocks, district landing
 * pages generated from launched service areas, the sitemap, and the
 * structured data search engines read. Blocks hold plain text only; nothing
 * is ever rendered as HTML.
 */

export const SITE_BLOCK_TYPES = ['hero', 'text', 'features', 'faq', 'cta', 'restaurants'] as const;
export type SiteBlockType = (typeof SITE_BLOCK_TYPES)[number];

/** A link inside a block: a path on the site or an https address. */
const HrefSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => (v.startsWith('/') && !v.startsWith('//')) || /^https:\/\/[^\s<>"]+$/.test(v), {
    message: 'link must be a site path or an https address',
  });
const Short = z.string().trim().min(1).max(120);
const Long = z.string().trim().min(1).max(2000);

export const SiteBlockSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('hero'),
      heading: Short,
      subheading: z.string().trim().max(300).optional(),
      ctaLabel: z.string().trim().min(1).max(40).optional(),
      ctaHref: HrefSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal('text'), heading: Short.optional(), body: Long }).strict(),
  z
    .object({
      type: z.literal('features'),
      heading: Short.optional(),
      items: z
        .array(z.object({ title: Short, body: z.string().trim().min(1).max(400) }).strict())
        .min(1)
        .max(6),
    })
    .strict(),
  z
    .object({
      type: z.literal('faq'),
      heading: Short.optional(),
      items: z
        .array(z.object({ question: z.string().trim().min(3).max(200), answer: Long }).strict())
        .min(1)
        .max(12),
    })
    .strict(),
  z
    .object({
      type: z.literal('cta'),
      heading: Short,
      body: z.string().trim().max(400).optional(),
      label: z.string().trim().min(1).max(40),
      href: HrefSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('restaurants'),
      heading: Short.optional(),
      /** A launched district as country|city|district; listed restaurants there are shown. */
      area: z
        .string()
        .trim()
        .regex(/^[A-Z]{2}\|[^|]{1,80}\|[^|]{1,80}$/),
    })
    .strict(),
]);
export type SiteBlock = z.infer<typeof SiteBlockSchema>;

/** Lowercase words joined by dashes, up to three segments: `restoranlar-icin`, `rehber/qr-menu`. */
export const SitePagePathSchema = z
  .string()
  .trim()
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,2}$/);

export const SITE_PAGE_STATUSES = ['DRAFT', 'PUBLISHED'] as const;
export type SitePageStatus = (typeof SITE_PAGE_STATUSES)[number];

export const UpsertSitePageSchema = z
  .object({
    path: SitePagePathSchema,
    locale: LocaleCodeSchema,
    /** Search result title; around 60 characters shows in full. */
    title: z.string().trim().min(3).max(70),
    /** Search result description; around 155 characters shows in full. */
    description: z.string().trim().min(10).max(160),
    blocks: z.array(SiteBlockSchema).min(1).max(30),
    /** Pages sharing this key are translations of each other (hreflang). */
    translationKey: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{2,60}$/)
      .optional(),
    status: z.enum(SITE_PAGE_STATUSES).default('DRAFT'),
  })
  .strict();
export type UpsertSitePageInput = z.infer<typeof UpsertSitePageSchema>;

export interface SitePageDTO {
  id: string;
  path: string;
  locale: string;
  title: string;
  description: string;
  blocks: SiteBlock[];
  translationKey: string | null;
  status: SitePageStatus;
  publishedAt: string | null;
  updatedAt: string;
}

export interface SiteRestaurantCardDTO {
  slug: string;
  name: string;
  logoUrl: string | null;
  district: string;
  city: string;
}

/** A block as the public page renders it; a restaurants block comes with its restaurants. */
export type PublicSiteBlock =
  | Exclude<SiteBlock, { type: 'restaurants' }>
  | (Extract<SiteBlock, { type: 'restaurants' }> & {
      restaurants: SiteRestaurantCardDTO[];
    });

export interface PublicSitePageDTO {
  path: string;
  locale: string;
  title: string;
  description: string;
  blocks: PublicSiteBlock[];
  /** The same page in other languages (hreflang). */
  alternates: { locale: string; path: string }[];
  updatedAt: string;
}

export interface DistrictLandingDTO {
  countryCode: string;
  city: string;
  district: string;
  path: string;
  restaurants: SiteRestaurantCardDTO[];
}

export interface RestaurantSeoDTO {
  slug: string;
  name: string;
  logoUrl: string | null;
  defaultLocale: string;
  address: { street: string; district: string; city: string; countryCode: string; postalCode: string | null } | null;
  /** The restaurant's verified own domain; its home page is then the canonical address. */
  customDomain: string | null;
  /** Structured data is published for this restaurant (page_engine on for it). */
  structuredData: boolean;
}

export interface SitemapEntryDTO {
  /** Site path, e.g. `/kadikoy-lokanta` or `/p/tr/restoranlar-icin`. */
  path: string;
  lastModified: string;
  /** locale -> path of the same page in that language. */
  alternates?: Record<string, string>;
}

export interface SitemapDTO {
  entries: SitemapEntryDTO[];
}

const PLACE_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** URL segment for a city or district name: `Kadıköy` -> `kadikoy`. */
export function placeSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .split('')
      .map((c) => PLACE_MAP[c] ?? c)
      .join('')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .join('-')
      .slice(0, 60) || 'bolge'
  );
}

/** The district landing page path of a launched service area. */
export function districtPath(city: string, district: string): string {
  return `/ilce/${placeSlug(city)}/${placeSlug(district)}`;
}

/** The public path of an engine page. */
export function sitePagePath(locale: string, path: string): string {
  return `/p/${locale}/${path}`;
}

// -- Structured data (schema.org JSON-LD) ------------------------------------------------

export type JsonLd = Record<string, unknown>;

export function restaurantJsonLd(seo: RestaurantSeoDTO, url: string): JsonLd {
  const data: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: seo.name,
    url,
    hasMenu: url,
    acceptsReservations: false,
  };
  if (seo.logoUrl) data.image = seo.logoUrl;
  if (seo.address) {
    data.address = {
      '@type': 'PostalAddress',
      streetAddress: seo.address.street,
      addressLocality: seo.address.district,
      addressRegion: seo.address.city,
      addressCountry: seo.address.countryCode,
      ...(seo.address.postalCode ? { postalCode: seo.address.postalCode } : {}),
    };
  }
  return data;
}

export function faqJsonLd(items: { question: string; answer: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.question,
      acceptedAnswer: { '@type': 'Answer', text: i.answer },
    })),
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function itemListJsonLd(items: { name: string; url: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, url: item.url })),
  };
}

/** JSON for a `<script type="application/ld+json">`: `<` is escaped so tenant text can never close the tag. */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Paths search engines are told to stay out of: sessions, panels, personal and one-time links. */
export const ROBOTS_DISALLOW = [
  '/panel',
  '/admin',
  '/pazarlama',
  '/hesabim',
  '/giris',
  '/kayit',
  '/api',
  '/t/',
  '/m/',
  '/j/',
  '/iptal/',
  '/onay/',
] as const;
