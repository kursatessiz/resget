import { AD_EVENT_NAMES, decimalToMinor, minorToDecimalString } from '@resget/shared';
import type { AdCallResult, AdConversionPayload, AdPlatformAdapter, AdSpendRow } from './ads.adapter';
import { AD_HTTP_TIMEOUT_MS, OK, fail, httpFailure } from './ads.adapter';

const API = 'https://business-api.tiktok.com/open_api/v1.3';

interface TikTokResponse {
  code?: number;
  message?: string;
  data?: { list?: { dimensions?: Record<string, string>; metrics?: Record<string, string> }[] };
}

/** TikTok Events API and reporting API (docs/REKLAM.md). */
export class TikTokAdsAdapter implements AdPlatformAdapter {
  readonly platform = 'TIKTOK' as const;
  readonly code = 'LIVE' as const;

  private async call(
    url: string,
    token: string,
    init?: RequestInit,
  ): Promise<{ status: number; body: TikTokResponse | null } | null> {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'Access-Token': token, 'content-type': 'application/json', ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(AD_HTTP_TIMEOUT_MS),
      });
      return { status: res.status, body: (await res.json().catch(() => null)) as TikTokResponse | null };
    } catch {
      return null;
    }
  }

  /** TikTok answers 200 with its own code: 0 is success, 40001 and 40100-40105 are token problems. */
  private result(res: { status: number; body: TikTokResponse | null } | null): AdCallResult {
    if (!res) return fail('NETWORK', true);
    if (res.status !== 200) return httpFailure(res.status, `TIKTOK_${res.status}`);
    const code = res.body?.code ?? -1;
    if (code === 0) return OK;
    if (code === 40001 || (code >= 40100 && code <= 40105)) return fail('CREDENTIALS_REFUSED', false, true);
    return fail(`TIKTOK_${code}`, code === 40100 || code >= 50000);
  }

  async verify(credentials: Record<string, string>): Promise<AdCallResult> {
    // Without an advertiser id there is nothing to look the pixel up under; the first event tells.
    if (!credentials.advertiserId) return OK;
    const params = new URLSearchParams({ advertiser_id: credentials.advertiserId, code: credentials.pixelCode });
    return this.result(await this.call(`${API}/pixel/list/?${params.toString()}`, credentials.accessToken));
  }

  async sendConversion(credentials: Record<string, string>, payload: AdConversionPayload): Promise<AdCallResult> {
    const user: Record<string, string> = {};
    if (payload.clickIds.ttclid) user.ttclid = payload.clickIds.ttclid;
    if (payload.hashedPhone) user.phone = payload.hashedPhone;
    if (payload.hashedEmail) user.email = payload.hashedEmail;
    const event: Record<string, unknown> = {
      event: AD_EVENT_NAMES.TIKTOK[payload.type],
      event_time: Math.floor(payload.occurredAt.getTime() / 1000),
      event_id: payload.eventId,
      user,
    };
    if (payload.landingUrl) event.page = { url: payload.landingUrl };
    if (payload.valueMinor !== null && payload.currency) {
      event.properties = {
        value: Number(minorToDecimalString(payload.valueMinor, payload.digits)),
        currency: payload.currency,
      };
    }
    return this.result(
      await this.call(`${API}/event/track/`, credentials.accessToken, {
        method: 'POST',
        body: JSON.stringify({ event_source: 'web', event_source_id: credentials.pixelCode, data: [event] }),
      }),
    );
  }

  async fetchSpend(
    credentials: Record<string, string>,
    from: string,
    to: string,
    fallbackCurrency: string,
    digitsOf: (currency: string) => number,
  ): Promise<AdSpendRow[]> {
    if (!credentials.advertiserId) return [];
    const params = new URLSearchParams({
      advertiser_id: credentials.advertiserId,
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
      metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'campaign_name']),
      start_date: from,
      end_date: to,
      page_size: '1000',
    });
    const res = await this.call(`${API}/report/integrated/get/?${params.toString()}`, credentials.accessToken);
    if (!res || res.status !== 200 || res.body?.code !== 0) return [];
    // The report carries no currency; the advertiser account's currency is the tenant's by convention.
    const digits = digitsOf(fallbackCurrency);
    return (res.body.data?.list ?? []).map((row) => ({
      date: (row.dimensions?.stat_time_day ?? '').slice(0, 10),
      campaignRef: row.dimensions?.campaign_id ?? 'unknown',
      campaignName: row.metrics?.campaign_name ?? null,
      spendMinor: decimalToMinor(row.metrics?.spend ?? '0', digits),
      currency: fallbackCurrency,
      impressions: Number(row.metrics?.impressions ?? 0),
      clicks: Number(row.metrics?.clicks ?? 0),
    }));
  }
}
