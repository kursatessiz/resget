import type { AdConnectionPlatform, ConversionType } from '@resget/shared';

/** One conversion as the ad platforms need it; hashes only when enhanced matching is on. */
export interface AdConversionPayload {
  /** The conversion row id: also the dedup key with the platform's own pixel or tag. */
  eventId: string;
  type: ConversionType;
  occurredAt: Date;
  valueMinor: number | null;
  currency: string | null;
  /** Minor unit digits of the currency. */
  digits: number;
  clickIds: Record<string, string>;
  clickedAt: Date | null;
  landingUrl: string | null;
  hashedPhone: string | null;
  hashedEmail: string | null;
  countryCode: string | null;
}

export interface AdCallResult {
  ok: boolean;
  errorCode: string | null;
  /** A temporary failure: try again later. */
  retryable: boolean;
  /** The platform refused the credentials: the connection needs attention. */
  authFailed?: boolean;
}

export interface AdSpendRow {
  /** YYYY-MM-DD in the ad account's reporting day. */
  date: string;
  campaignRef: string;
  campaignName: string | null;
  spendMinor: number;
  currency: string;
  impressions: number;
  clicks: number;
}

/**
 * One ad platform's conversion and reporting API (docs/REKLAM.md). Adapters
 * never throw: network and API errors come back as results.
 */
export interface AdPlatformAdapter {
  readonly platform: AdConnectionPlatform;
  readonly code: 'MOCK' | 'LIVE';
  verify(credentials: Record<string, string>): Promise<AdCallResult>;
  sendConversion(credentials: Record<string, string>, payload: AdConversionPayload): Promise<AdCallResult>;
  /** Daily spend per campaign between two dates (inclusive). */
  fetchSpend(
    credentials: Record<string, string>,
    from: string,
    to: string,
    fallbackCurrency: string,
    digitsOf: (currency: string) => number,
  ): Promise<AdSpendRow[]>;
}

export const OK: AdCallResult = { ok: true, errorCode: null, retryable: false };

export function fail(errorCode: string, retryable: boolean, authFailed = false): AdCallResult {
  return { ok: false, errorCode, retryable, authFailed };
}

/** HTTP status to result: 401/403 refuse the credentials, 429 and 5xx are worth another try. */
export function httpFailure(status: number, code: string): AdCallResult {
  if (status === 401 || status === 403) return fail(code, false, true);
  return fail(code, status === 429 || status >= 500);
}

export const AD_HTTP_TIMEOUT_MS = 10_000;

/**
 * Development stand-in for every platform. Outside production it accepts
 * and records what it would have sent; a credential value of "invalid" is
 * refused and "flaky" fails once with a retryable error. In production it
 * refuses, so nothing pretends a conversion reached an ad platform.
 */
export class MockAdsAdapter implements AdPlatformAdapter {
  readonly code = 'MOCK' as const;
  readonly sent: { credentials: Record<string, string>; payload: AdConversionPayload }[] = [];
  private flakyFailed = new Set<string>();

  constructor(
    readonly platform: AdConnectionPlatform,
    private readonly production: boolean,
  ) {}

  private refused(credentials: Record<string, string>): boolean {
    return Object.values(credentials).includes('invalid');
  }

  async verify(credentials: Record<string, string>): Promise<AdCallResult> {
    if (this.production) return fail('MOCK_IN_PRODUCTION', false);
    return this.refused(credentials) ? fail('CREDENTIALS_REFUSED', false, true) : OK;
  }

  async sendConversion(credentials: Record<string, string>, payload: AdConversionPayload): Promise<AdCallResult> {
    if (this.production) return fail('MOCK_IN_PRODUCTION', false);
    if (this.refused(credentials)) return fail('CREDENTIALS_REFUSED', false, true);
    if (Object.values(credentials).includes('flaky') && !this.flakyFailed.has(payload.eventId)) {
      this.flakyFailed.add(payload.eventId);
      return fail('TEMPORARY', true);
    }
    this.sent.push({ credentials, payload });
    if (this.sent.length > 200) this.sent.shift();
    return OK;
  }

  async fetchSpend(
    credentials: Record<string, string>,
    from: string,
    to: string,
    fallbackCurrency: string,
    digitsOf: (currency: string) => number,
  ): Promise<AdSpendRow[]> {
    if (this.production || this.refused(credentials)) return [];
    const rows: AdSpendRow[] = [];
    const unit = 10 ** digitsOf(fallbackCurrency);
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
      rows.push({
        date: new Date(t).toISOString().slice(0, 10),
        campaignRef: `mock-${this.platform.toLowerCase()}`,
        campaignName: 'Mock',
        spendMinor: 25 * unit,
        currency: fallbackCurrency,
        impressions: 1000,
        clicks: 40,
      });
    }
    return rows;
  }
}
