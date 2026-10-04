import { microsToMinor, minorToDecimalString } from '@resget/shared';
import type { AdCallResult, AdConversionPayload, AdPlatformAdapter, AdSpendRow } from './ads.adapter';
import { AD_HTTP_TIMEOUT_MS, OK, fail, httpFailure } from './ads.adapter';

const ADS = 'https://googleads.googleapis.com/v18';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface GoogleAdsAppConfig {
  clientId?: string;
  clientSecret?: string;
  developerToken?: string;
}

/** "2026-10-04 12:30:00+00:00", the format offline click conversions expect. */
export function googleDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace('T', ' ')}+00:00`;
}

/** Google Ads API: offline click conversions and campaign cost (docs/REKLAM.md). */
export class GoogleAdsAdapter implements AdPlatformAdapter {
  readonly platform = 'GOOGLE' as const;
  readonly code = 'LIVE' as const;

  constructor(private readonly app: GoogleAdsAppConfig) {}

  private configured(): boolean {
    return Boolean(this.app.clientId && this.app.clientSecret && this.app.developerToken);
  }

  private async token(refreshToken: string): Promise<string | null | 'refused'> {
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.app.clientId ?? '',
          client_secret: this.app.clientSecret ?? '',
          refresh_token: refreshToken,
        }).toString(),
        signal: AbortSignal.timeout(AD_HTTP_TIMEOUT_MS),
      });
      if (res.status === 400 || res.status === 401) return 'refused';
      if (!res.ok) return null;
      return ((await res.json()) as { access_token?: string }).access_token ?? null;
    } catch {
      return null;
    }
  }

  private async call(
    credentials: Record<string, string>,
    path: string,
    body: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> | null } | AdCallResult> {
    if (!this.configured()) return fail('GOOGLE_ADS_NOT_CONFIGURED', false);
    const token = await this.token(credentials.refreshToken);
    if (token === 'refused') return fail('CREDENTIALS_REFUSED', false, true);
    if (!token) return fail('NETWORK', true);
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'developer-token': this.app.developerToken ?? '',
      'content-type': 'application/json',
    };
    if (credentials.loginCustomerId) headers['login-customer-id'] = credentials.loginCustomerId.replace(/-/g, '');
    try {
      const res = await fetch(`${ADS}/${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AD_HTTP_TIMEOUT_MS),
      });
      return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    } catch {
      return fail('NETWORK', true);
    }
  }

  private customer(credentials: Record<string, string>): string {
    return credentials.customerId.replace(/-/g, '');
  }

  async verify(credentials: Record<string, string>): Promise<AdCallResult> {
    const res = await this.call(credentials, `customers/${this.customer(credentials)}/googleAds:search`, {
      query: `SELECT conversion_action.id FROM conversion_action WHERE conversion_action.id = ${Number(credentials.conversionActionId) || 0}`,
    });
    if ('ok' in res) return res;
    return res.status === 200 ? OK : httpFailure(res.status, `GOOGLE_${res.status}`);
  }

  async sendConversion(credentials: Record<string, string>, payload: AdConversionPayload): Promise<AdCallResult> {
    const customer = this.customer(credentials);
    const conversion: Record<string, unknown> = {
      conversionAction: `customers/${customer}/conversionActions/${credentials.conversionActionId}`,
      conversionDateTime: googleDateTime(payload.occurredAt),
      orderId: payload.eventId,
    };
    for (const key of ['gclid', 'gbraid', 'wbraid'] as const) {
      if (payload.clickIds[key]) {
        conversion[key] = payload.clickIds[key];
        break;
      }
    }
    if (payload.valueMinor !== null && payload.currency) {
      conversion.conversionValue = Number(minorToDecimalString(payload.valueMinor, payload.digits));
      conversion.currencyCode = payload.currency;
    }
    const identifiers: Record<string, string>[] = [];
    if (payload.hashedEmail) identifiers.push({ hashedEmail: payload.hashedEmail });
    if (payload.hashedPhone) identifiers.push({ hashedPhoneNumber: payload.hashedPhone });
    if (identifiers.length) conversion.userIdentifiers = identifiers;
    const res = await this.call(credentials, `customers/${customer}:uploadClickConversions`, {
      conversions: [conversion],
      partialFailure: true,
    });
    if ('ok' in res) return res;
    if (res.status !== 200) return httpFailure(res.status, `GOOGLE_${res.status}`);
    // With partial failure on, a refused row comes back as a 200 carrying the error.
    return res.body?.partialFailureError ? fail('GOOGLE_PARTIAL_FAILURE', false) : OK;
  }

  async fetchSpend(
    credentials: Record<string, string>,
    from: string,
    to: string,
    fallbackCurrency: string,
    digitsOf: (currency: string) => number,
  ): Promise<AdSpendRow[]> {
    const res = await this.call(credentials, `customers/${this.customer(credentials)}/googleAds:search`, {
      query:
        'SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, ' +
        `customer.currency_code FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    });
    if ('ok' in res || res.status !== 200) return [];
    const results = (res.body?.results ?? []) as {
      campaign?: { id?: string; name?: string };
      segments?: { date?: string };
      metrics?: { costMicros?: string; impressions?: string; clicks?: string };
      customer?: { currencyCode?: string };
    }[];
    return results.map((r) => {
      const currency = r.customer?.currencyCode || fallbackCurrency;
      return {
        date: r.segments?.date ?? from,
        campaignRef: r.campaign?.id ?? 'unknown',
        campaignName: r.campaign?.name ?? null,
        spendMinor: microsToMinor(Number(r.metrics?.costMicros ?? 0), digitsOf(currency)),
        currency,
        impressions: Number(r.metrics?.impressions ?? 0),
        clicks: Number(r.metrics?.clicks ?? 0),
      };
    });
  }
}
