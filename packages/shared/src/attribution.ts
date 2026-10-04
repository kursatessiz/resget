import { z } from 'zod';
import { shareOf } from './money';
import { PhoneSchema } from './validators';

/**
 * Visitors, touchpoints and conversions (docs/ATIF.md). A restaurant's
 * ordering pages and the platform's own site record where a visit came from
 * (UTM tags, ad click ids, a table QR, a referring site), but only after the
 * visitor allowed it, and never the query string, the IP address or anything
 * that identifies a person. When a visitor orders or signs up, the server
 * links the visitor to the contact and the conversion is attributed to the
 * contact's touchpoints. Behind the attribution module switch.
 */

// -- Cookies and headers ---------------------------------------------------------------

/** Anonymous visitor id, set only after analytics consent; 13 months. */
export const VISITOR_COOKIE = 'rg_vid';
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 395 * 24 * 60 * 60;
/** Visit session, ends after 30 minutes without a page view. */
export const VISIT_SESSION_COOKIE = 'rg_sid';
export const VISIT_SESSION_MAX_AGE_SECONDS = 30 * 60;
/** The visitor's consent choice itself (strictly necessary); 180 days. */
export const CONSENT_COOKIE = 'rg_consent';
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
/** Bump when the banner's purposes change; an older choice is asked again. */
export const CONSENT_VERSION = 1;
/** The BFF passes the visitor cookie to the API in this header; the API never trusts it for anything but linking. */
export const VISITOR_HEADER = 'x-visitor-id';

export const VisitorIdSchema = z.string().regex(/^[a-f0-9]{32}$/);

// -- Consent ---------------------------------------------------------------------------

/**
 * How the banner behaves for the visitor's region:
 * - OPT_IN: EU/EEA, UK, Switzerland, Canada; nothing is written or sent before an explicit yes.
 * - KVKK: Turkey; the KVKK notice with accept and reject, nothing before a yes.
 * - NOTICE: elsewhere; an information banner, measurement starts at once, advertising can be turned off.
 * An unknown region gets the strictest behaviour.
 */
export type ConsentRegime = 'OPT_IN' | 'KVKK' | 'NOTICE';

const OPT_IN_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH', 'CA',
]); // prettier-ignore

export function consentRegimeFor(countryCode: string | null | undefined): ConsentRegime {
  const code = countryCode?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code)) return 'OPT_IN';
  if (code === 'TR') return 'KVKK';
  return OPT_IN_COUNTRIES.has(code) ? 'OPT_IN' : 'NOTICE';
}

/**
 * The visitor's country for the banner: the edge proxy's header first, then
 * the region subtag of the first language the browser prefers.
 */
export function visitorCountry(
  edgeCountry: string | null | undefined,
  acceptLanguage: string | null | undefined,
): string | null {
  const edge = edgeCountry?.trim().toUpperCase();
  if (edge && /^[A-Z]{2}$/.test(edge) && edge !== 'XX' && edge !== 'T1') return edge;
  const first = acceptLanguage?.split(',')[0]?.split(';')[0]?.trim();
  const region = first?.split('-')[1]?.toUpperCase();
  return region && /^[A-Z]{2}$/.test(region) ? region : null;
}

export interface ConsentChoice {
  analytics: boolean;
  advertising: boolean;
}

/** Cookie value: `<version>.<analytics 0|1>.<advertising 0|1>`; advertising never without analytics. */
export function encodeConsent(choice: ConsentChoice): string {
  const analytics = choice.analytics ? 1 : 0;
  const advertising = choice.analytics && choice.advertising ? 1 : 0;
  return `${CONSENT_VERSION}.${analytics}.${advertising}`;
}

/** A stored choice of the current version, or null (the banner asks again). */
export function decodeConsent(value: string | null | undefined): ConsentChoice | null {
  const match = /^(\d+)\.([01])\.([01])$/.exec(value ?? '');
  if (!match || Number(match[1]) !== CONSENT_VERSION) return null;
  const analytics = match[2] === '1';
  return { analytics, advertising: analytics && match[3] === '1' };
}

/**
 * What applies right now. Without a stored choice only the NOTICE regime
 * measures; Global Privacy Control always turns advertising off.
 */
export function effectiveConsent(
  regime: ConsentRegime,
  stored: ConsentChoice | null,
  globalPrivacyControl: boolean,
): ConsentChoice {
  const base = stored ?? (regime === 'NOTICE' ? { analytics: true, advertising: true } : NO_CONSENT);
  return { analytics: base.analytics, advertising: base.analytics && base.advertising && !globalPrivacyControl };
}

const NO_CONSENT: ConsentChoice = { analytics: false, advertising: false };

/** The banner is shown until the visitor chose, in every regime. */
export function consentBannerNeeded(stored: ConsentChoice | null): boolean {
  return stored === null;
}

// -- Tracking parameters ---------------------------------------------------------------

export const AD_PLATFORMS = ['GOOGLE', 'META', 'TIKTOK', 'MICROSOFT', 'LINKEDIN'] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

/** Click ids by the platform that sets them. Stored only with advertising consent. */
const CLICK_ID_PLATFORMS: Readonly<Record<string, AdPlatform>> = {
  gclid: 'GOOGLE',
  gbraid: 'GOOGLE',
  wbraid: 'GOOGLE',
  fbclid: 'META',
  ttclid: 'TIKTOK',
  msclkid: 'MICROSOFT',
  li_fat_id: 'LINKEDIN',
};
export const CLICK_ID_KEYS = Object.keys(CLICK_ID_PLATFORMS);

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id'] as const;
/** Our own ids in ad links: campaign, ad set and ad ids survive renames; `rg_ref` is a referral code. */
const OWN_KEYS = ['rg_cid', 'rg_asid', 'rg_adid', 'rg_ref'] as const;

/** The part of URLSearchParams used here; shared code runs without the DOM library. */
export interface QueryParams {
  get(key: string): string | null;
  has(key: string): boolean;
}

export interface TrackingParams {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  utmId: string | null;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  refCode: string | null;
  clickIds: Record<string, string>;
  adPlatform: AdPlatform | null;
}

function clean(value: string | null, max = 200): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Reads the tracking parameters of a landing URL; everything else in the query string is dropped. */
export function parseTrackingParams(search: QueryParams): TrackingParams {
  const get = (key: string) => clean(search.get(key));
  const clickIds: Record<string, string> = {};
  for (const key of CLICK_ID_KEYS) {
    const value = clean(search.get(key), 500);
    if (value) clickIds[key] = value;
  }
  const utmSource = get('utm_source');
  return {
    utmSource: utmSource?.toLowerCase() ?? null,
    utmMedium: get('utm_medium')?.toLowerCase() ?? null,
    utmCampaign: get('utm_campaign'),
    utmTerm: get('utm_term'),
    utmContent: get('utm_content'),
    utmId: get('utm_id'),
    campaignId: get('rg_cid'),
    adsetId: get('rg_asid'),
    adId: get('rg_adid'),
    refCode: get('rg_ref'),
    clickIds,
    adPlatform: detectAdPlatform(clickIds, utmSource),
  };
}

const SOURCE_PLATFORMS: Readonly<Record<string, AdPlatform>> = {
  google: 'GOOGLE',
  facebook: 'META',
  instagram: 'META',
  meta: 'META',
  tiktok: 'TIKTOK',
  bing: 'MICROSOFT',
  microsoft: 'MICROSOFT',
  linkedin: 'LINKEDIN',
};

export function detectAdPlatform(clickIds: Record<string, string>, utmSource: string | null): AdPlatform | null {
  for (const key of CLICK_ID_KEYS) if (clickIds[key]) return CLICK_ID_PLATFORMS[key];
  return (utmSource && SOURCE_PLATFORMS[utmSource.toLowerCase()]) || null;
}

/** A paid click (click id present) whose link lacks our campaign and ad set ids: it cannot be reported by campaign. */
export function isUntaggedPaidTraffic(params: Pick<TrackingParams, 'clickIds' | 'campaignId' | 'adsetId'>): boolean {
  return Object.keys(params.clickIds).length > 0 && (!params.campaignId || !params.adsetId);
}

/** Whether a landing URL carries anything worth a touchpoint outside the first page of a session. */
export function hasTrackingParams(search: QueryParams): boolean {
  return [...UTM_KEYS, ...OWN_KEYS, ...CLICK_ID_KEYS].some((key) => search.has(key));
}

export type DeviceType = 'MOBILE' | 'TABLET' | 'DESKTOP';

export function deviceTypeOf(userAgent: string): DeviceType {
  if (/ipad|tablet|kindle|silk|playbook/i.test(userAgent) || (/android/i.test(userAgent) && !/mobile/i.test(userAgent)))
    return 'TABLET';
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(userAgent)) return 'MOBILE';
  return 'DESKTOP';
}

const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|whatsapp|telegram|skype|discord|headlesschrome|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|httpclient|axios|node-fetch|go-http|java\//i;

/** Known crawlers, link previews, monitors and command line clients; an empty user agent counts as a bot. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT_PATTERN.test(userAgent);
}

// -- Touchpoint input ------------------------------------------------------------------

export const TouchpointInputSchema = z
  .object({
    visitorId: VisitorIdSchema,
    sessionId: VisitorIdSchema,
    /** The full landing URL as the browser saw it; only host, path and tracking parameters are kept. */
    url: z.string().url().max(2000),
    referrer: z.string().max(2000).nullable(),
    consent: z.object({ analytics: z.boolean(), advertising: z.boolean() }).strict(),
    locale: z.string().min(2).max(10).nullable(),
    /** Set on a table QR page: the visit is tied to the table it was scanned at. */
    tableToken: z.string().min(8).max(64).nullable(),
  })
  .strict();
export type TouchpointInput = z.infer<typeof TouchpointInputSchema>;

// -- Conversions -----------------------------------------------------------------------

/**
 * Restaurant tenants: a customer's first and later completed orders.
 * Platform tenant: a lead from the site form, a restaurant sign-up, and the
 * restaurant's first paid platform invoice.
 */
export const CONVERSION_TYPES = ['first_order', 'repeat_order', 'lead', 'restaurant_signup', 'first_payment'] as const;
export type ConversionType = (typeof CONVERSION_TYPES)[number];
export const RESTAURANT_CONVERSION_TYPES: readonly ConversionType[] = ['first_order', 'repeat_order'];
export const PLATFORM_CONVERSION_TYPES: readonly ConversionType[] = ['lead', 'restaurant_signup', 'first_payment'];

/** A conversion is attributed to touchpoints at most this many days before it. */
export const ATTRIBUTION_WINDOW_DAYS = 30;

// -- Attribution -----------------------------------------------------------------------

export const ATTRIBUTION_MODELS = ['LAST_TOUCH', 'FIRST_TOUCH', 'LINEAR'] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];
export const ATTRIBUTION_GROUPS = ['source', 'medium', 'campaign'] as const;
export type AttributionGroup = (typeof ATTRIBUTION_GROUPS)[number];
/** The longest range one report covers. */
export const ATTRIBUTION_MAX_RANGE_DAYS = 366;

export const AttributionQuerySchema = z
  .object({
    model: z.enum(ATTRIBUTION_MODELS).default('LAST_TOUCH'),
    groupBy: z.enum(ATTRIBUTION_GROUPS).default('source'),
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .strict()
  .refine((q) => q.from < q.to, { message: 'from must be before to', path: ['from'] })
  .refine((q) => q.to.getTime() - q.from.getTime() <= ATTRIBUTION_MAX_RANGE_DAYS * 86_400_000, {
    message: 'Range too long',
    path: ['to'],
  });
export type AttributionQuery = z.infer<typeof AttributionQuerySchema>;

/** The part of a touchpoint attribution looks at. */
export interface AttributableTouchpoint {
  id: string;
  occurredAt: Date;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmId: string | null;
  campaignId: string | null;
  adPlatform: string | null;
  referrerHost: string | null;
  tableId: string | null;
}

/** Placeholder keys; the screen translates them (`attribution.key.<key>`). */
export const DIRECT_KEY = '(direct)';
export const NONE_KEY = '(none)';

/** The report key of a touchpoint for a grouping. Ids before names, so a renamed campaign keeps its row. */
export function touchpointKey(touchpoint: AttributableTouchpoint | null, group: AttributionGroup): string {
  if (!touchpoint) return group === 'source' ? DIRECT_KEY : NONE_KEY;
  switch (group) {
    case 'source':
      return (
        touchpoint.utmSource ??
        touchpoint.adPlatform?.toLowerCase() ??
        (touchpoint.tableId ? 'qr' : null) ??
        touchpoint.referrerHost ??
        DIRECT_KEY
      );
    case 'medium':
      return (
        touchpoint.utmMedium ??
        (touchpoint.adPlatform ? 'cpc' : null) ??
        (touchpoint.tableId ? 'table' : null) ??
        (touchpoint.referrerHost ? 'referral' : null) ??
        NONE_KEY
      );
    case 'campaign':
      return touchpoint.campaignId ?? touchpoint.utmId ?? touchpoint.utmCampaign ?? NONE_KEY;
  }
}

export interface WeightedTouchpoint {
  touchpoint: AttributableTouchpoint | null;
  /** Share of the conversion, as a fraction part/whole so money is split with shareOf(). */
  part: number;
  whole: number;
}

/**
 * Which touchpoints a conversion is credited to. Only touchpoints before the
 * conversion count; LAST_TOUCH and LINEAR also only within the window,
 * FIRST_TOUCH takes the earliest ever. Without one the conversion is direct.
 */
export function attributeConversion(
  model: AttributionModel,
  touchpoints: readonly AttributableTouchpoint[],
  occurredAt: Date,
  windowDays: number = ATTRIBUTION_WINDOW_DAYS,
): WeightedTouchpoint[] {
  const before = touchpoints
    .filter((t) => t.occurredAt <= occurredAt)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const windowStart = occurredAt.getTime() - windowDays * 86_400_000;
  const inWindow = before.filter((t) => t.occurredAt.getTime() >= windowStart);
  if (model === 'FIRST_TOUCH') return [{ touchpoint: before[0] ?? null, part: 1, whole: 1 }];
  if (model === 'LAST_TOUCH') return [{ touchpoint: inWindow[inWindow.length - 1] ?? null, part: 1, whole: 1 }];
  if (inWindow.length === 0) return [{ touchpoint: null, part: 1, whole: 1 }];
  return inWindow.map((touchpoint) => ({ touchpoint, part: 1, whole: inWindow.length }));
}

export interface AttributableConversion {
  type: ConversionType;
  occurredAt: Date;
  valueMinor: number | null;
  currency: string | null;
  touchpoints: readonly AttributableTouchpoint[];
}

export interface AttributionRowDTO {
  key: string;
  /** Conversions credited to the key by type; fractional under LINEAR (four decimals). */
  conversions: Partial<Record<ConversionType, number>>;
  /** Credited value by currency, in minor units. */
  revenue: { currency: string; minor: number }[];
}

export interface AttributionReportDTO {
  enabled: boolean;
  model: AttributionModel;
  groupBy: AttributionGroup;
  from: string;
  to: string;
  windowDays: number;
  types: readonly ConversionType[];
  rows: AttributionRowDTO[];
  totals: AttributionRowDTO;
  /** Touchpoints in the range, and those with a click id but without our campaign ids. */
  visits: number;
  untaggedPaidVisits: number;
}

function addRevenue(row: AttributionRowDTO, currency: string, minor: number): void {
  const existing = row.revenue.find((r) => r.currency === currency);
  if (existing) existing.minor += minor;
  else row.revenue.push({ currency, minor });
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Credits every conversion to its keys; rows ordered by total conversions, then key. */
export function aggregateAttribution(
  conversions: readonly AttributableConversion[],
  model: AttributionModel,
  groupBy: AttributionGroup,
  windowDays: number = ATTRIBUTION_WINDOW_DAYS,
): { rows: AttributionRowDTO[]; totals: AttributionRowDTO } {
  const rows = new Map<string, AttributionRowDTO>();
  const totals: AttributionRowDTO = { key: '', conversions: {}, revenue: [] };
  for (const conversion of conversions) {
    totals.conversions[conversion.type] = (totals.conversions[conversion.type] ?? 0) + 1;
    if (conversion.valueMinor !== null && conversion.currency)
      addRevenue(totals, conversion.currency, conversion.valueMinor);
    for (const credit of attributeConversion(model, conversion.touchpoints, conversion.occurredAt, windowDays)) {
      const key = touchpointKey(credit.touchpoint, groupBy);
      const row = rows.get(key) ?? { key, conversions: {}, revenue: [] };
      row.conversions[conversion.type] = round4((row.conversions[conversion.type] ?? 0) + credit.part / credit.whole);
      if (conversion.valueMinor !== null && conversion.currency)
        addRevenue(row, conversion.currency, shareOf(conversion.valueMinor, credit.part, credit.whole));
      rows.set(key, row);
    }
  }
  const total = (row: AttributionRowDTO) => Object.values(row.conversions).reduce((sum, n) => sum + (n ?? 0), 0);
  return {
    rows: [...rows.values()].sort((a, b) => total(b) - total(a) || a.key.localeCompare(b.key)),
    totals,
  };
}

// -- Contact card ----------------------------------------------------------------------

export interface ContactTouchpointDTO {
  id: string;
  occurredAt: string;
  source: string;
  medium: string;
  campaign: string;
  landingPath: string;
  tableLabel: string | null;
}

export interface ContactConversionDTO {
  id: string;
  type: ConversionType;
  occurredAt: string;
  valueMinor: number | null;
  currency: string | null;
  /** Last-touch source at the time of the conversion. */
  source: string;
}

export interface ContactAttributionDTO {
  touchpoints: ContactTouchpointDTO[];
  conversions: ContactConversionDTO[];
}

// -- Platform lead form ----------------------------------------------------------------

/** The platform site's "tell me more" form: a lead in the platform's pipeline (docs/ATIF.md). */
export const PlatformLeadSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: PhoneSchema,
    restaurantName: z.string().trim().min(2).max(120),
    city: z.string().trim().max(80).optional(),
    district: z.string().trim().max(80).optional(),
    /** The visitor read the privacy notice; the form refuses without it. */
    privacyAccepted: z.literal(true),
    /** Separate, unticked box: campaign and news messages by SMS (docs/RIZA.md). */
    marketingConsent: z.boolean().optional(),
  })
  .strict();
export type PlatformLeadInput = z.infer<typeof PlatformLeadSchema>;

/** Version of the lead form's consent text; bump with the text (stored with each consent). */
export const PLATFORM_LEAD_FORM_VERSION = 'lead-form-1';

/** Whether the platform's site tracks visits and shows the lead form. */
export interface PlatformSiteDTO {
  tracking: boolean;
  leadForm: boolean;
}
