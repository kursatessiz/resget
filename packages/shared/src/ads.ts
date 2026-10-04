import { z } from 'zod';
import { CONVERSION_TYPES } from './attribution';
import type { ConversionType } from './attribution';

/**
 * Ad platform integrations (docs/REKLAM.md, module ad_integrations): a
 * tenant connects its own ad accounts; conversions recorded by attribution
 * (docs/ATIF.md) go to the platform's conversion API, and daily spend comes
 * back for the performance report. Only conversions whose visit carried
 * advertising consent are ever sent; hashed contact data is off by default.
 */

export const AD_CONNECTION_PLATFORMS = ['META', 'GOOGLE', 'TIKTOK'] as const;
export type AdConnectionPlatform = (typeof AD_CONNECTION_PLATFORMS)[number];

export interface AdCredentialField {
  key: string;
  /** Secret fields are stored encrypted and never shown again. */
  secret: boolean;
  optional?: boolean;
}

export const AD_CREDENTIAL_FIELDS: Readonly<Record<AdConnectionPlatform, readonly AdCredentialField[]>> = {
  META: [
    { key: 'pixelId', secret: false },
    { key: 'accessToken', secret: true },
    { key: 'adAccountId', secret: false, optional: true },
    { key: 'testEventCode', secret: false, optional: true },
  ],
  GOOGLE: [
    { key: 'customerId', secret: false },
    { key: 'conversionActionId', secret: false },
    { key: 'refreshToken', secret: true },
    { key: 'loginCustomerId', secret: false, optional: true },
  ],
  TIKTOK: [
    { key: 'pixelCode', secret: false },
    { key: 'accessToken', secret: true },
    { key: 'advertiserId', secret: false, optional: true },
  ],
};

/** The click id parameters each platform can match a conversion on (docs/ATIF.md stores them with consent). */
export const AD_CLICK_ID_KEYS: Readonly<Record<AdConnectionPlatform, readonly string[]>> = {
  META: ['fbclid'],
  GOOGLE: ['gclid', 'gbraid', 'wbraid'],
  TIKTOK: ['ttclid'],
};

/** Standard event names per platform; Google uses the connection's conversion action instead. */
export const AD_EVENT_NAMES: Readonly<Record<'META' | 'TIKTOK', Record<ConversionType, string>>> = {
  META: {
    first_order: 'Purchase',
    repeat_order: 'Purchase',
    lead: 'Lead',
    restaurant_signup: 'CompleteRegistration',
    first_payment: 'Subscribe',
  },
  TIKTOK: {
    first_order: 'CompletePayment',
    repeat_order: 'CompletePayment',
    lead: 'SubmitForm',
    restaurant_signup: 'CompleteRegistration',
    first_payment: 'Subscribe',
  },
};

export const AD_DELIVERY_MAX_ATTEMPTS = 5;
/** Spend is pulled at most this often per connection, for the last AD_SPEND_LOOKBACK_DAYS days. */
export const AD_SPEND_SYNC_HOURS = 6;
export const AD_SPEND_LOOKBACK_DAYS = 7;
export const AD_REPORT_RANGE_DAYS = [7, 30, 90] as const;

const CredentialValue = z.string().trim().min(1).max(2000);

export const ConnectAdSchema = z
  .object({
    credentials: z.record(z.string(), CredentialValue),
    sendTypes: z.array(z.enum(CONVERSION_TYPES)).min(1).max(CONVERSION_TYPES.length).optional(),
    /** Hashed phone and e-mail in conversions; needs a legal basis the business confirms (docs/REKLAM.md). */
    enhancedMatching: z.boolean().optional(),
  })
  .strict();
export type ConnectAdInput = z.infer<typeof ConnectAdSchema>;

export const UpdateAdConnectionSchema = z
  .object({
    status: z.enum(['ACTIVE', 'PAUSED']).optional(),
    sendTypes: z.array(z.enum(CONVERSION_TYPES)).min(1).max(CONVERSION_TYPES.length).optional(),
    enhancedMatching: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type UpdateAdConnectionInput = z.infer<typeof UpdateAdConnectionSchema>;

export const AdReportQuerySchema = z
  .object({
    days: z.coerce
      .number()
      .int()
      .refine((d) => (AD_REPORT_RANGE_DAYS as readonly number[]).includes(d), { message: 'unsupported range' })
      .default(30),
  })
  .strict();

/** Which required fields a credential set is missing; unknown keys are refused too. */
export function adCredentialIssues(platform: AdConnectionPlatform, credentials: Record<string, string>): string[] {
  const fields = AD_CREDENTIAL_FIELDS[platform];
  const known = new Set(fields.map((f) => f.key));
  const issues = fields.filter((f) => !f.optional && !credentials[f.key]?.trim()).map((f) => `missing:${f.key}`);
  for (const key of Object.keys(credentials)) if (!known.has(key)) issues.push(`unknown:${key}`);
  return issues;
}

/**
 * A decimal amount as a platform reports it ("12.5", "0.07") in minor
 * units of a currency with `digits` decimals, without float arithmetic.
 * Extra decimals are rounded half up once.
 */
export function decimalToMinor(value: string, digits: number): number {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return 0;
  const [, sign, whole, fraction = ''] = match;
  const padded = (fraction + '0'.repeat(digits + 1)).slice(0, digits + 1);
  const base = Number(whole) * 10 ** digits + Number(padded.slice(0, digits) || '0');
  const rounded = Number(padded.slice(digits, digits + 1)) >= 5 ? base + 1 : base;
  return sign === '-' ? -rounded : rounded;
}

/** Google reports cost in micros of the account currency. */
export function microsToMinor(micros: number, digits: number): number {
  return Math.round(micros / 10 ** (6 - digits));
}

/** The minor amount as the decimal string the conversion APIs expect ("12.50"). */
export function minorToDecimalString(minor: number, digits: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor)
    .toString()
    .padStart(digits + 1, '0');
  const text = digits === 0 ? abs : `${abs.slice(0, -digits)}.${abs.slice(-digits)}`;
  return negative ? `-${text}` : text;
}

/** Meta's click id cookie value built from the stored fbclid and the click time. */
export function metaFbc(fbclid: string, clickedAt: Date): string {
  return `fb.1.${clickedAt.getTime()}.${fbclid}`;
}

export interface AdConnectionDTO {
  platform: AdConnectionPlatform;
  status: 'ACTIVE' | 'PAUSED' | 'ERROR';
  /** Non-secret fields as entered; secret fields only as `set`. */
  config: Record<string, string>;
  secretsSet: string[];
  sendTypes: ConversionType[];
  enhancedMatching: boolean;
  lastSentAt: string | null;
  lastSpendSyncAt: string | null;
  lastError: string | null;
  deliveries: { pending: number; sent: number; skipped: number; failed: number };
  createdAt: string;
}

export interface AdPerformanceRowDTO {
  platform: AdConnectionPlatform;
  currency: string;
  spendMinor: number;
  impressions: number;
  clicks: number;
  /** Conversions whose last touch came from this platform (docs/ATIF.md), and their value. */
  conversions: number;
  revenueMinor: number;
  /** revenue / spend in basis points when both are in this currency and spend is not zero. */
  roasBps: number | null;
}

export interface AdPerformanceDTO {
  days: number;
  rows: AdPerformanceRowDTO[];
}
