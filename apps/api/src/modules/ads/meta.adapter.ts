import { AD_EVENT_NAMES, decimalToMinor, metaFbc, minorToDecimalString } from '@resget/shared';
import type { AdCallResult, AdConversionPayload, AdPlatformAdapter, AdSpendRow } from './ads.adapter';
import { AD_HTTP_TIMEOUT_MS, OK, fail, httpFailure } from './ads.adapter';

const GRAPH = 'https://graph.facebook.com/v21.0';

interface GraphError {
  error?: { code?: number; message?: string };
}

/** Meta Conversions API and Marketing API insights (docs/REKLAM.md). */
export class MetaAdsAdapter implements AdPlatformAdapter {
  readonly platform = 'META' as const;
  readonly code = 'LIVE' as const;

  private async call(url: string, init?: RequestInit): Promise<{ status: number; body: unknown } | null> {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(AD_HTTP_TIMEOUT_MS) });
      return { status: res.status, body: await res.json().catch(() => null) };
    } catch {
      return null;
    }
  }

  private failure(status: number, body: unknown): AdCallResult {
    const code = (body as GraphError | null)?.error?.code;
    // 190: expired or invalid access token.
    if (code === 190) return fail('CREDENTIALS_REFUSED', false, true);
    return httpFailure(status, `META_${code ?? status}`);
  }

  async verify(credentials: Record<string, string>): Promise<AdCallResult> {
    const res = await this.call(
      `${GRAPH}/${encodeURIComponent(credentials.pixelId)}?fields=id&access_token=${encodeURIComponent(credentials.accessToken)}`,
    );
    if (!res) return fail('NETWORK', true);
    return res.status === 200 ? OK : this.failure(res.status, res.body);
  }

  async sendConversion(credentials: Record<string, string>, payload: AdConversionPayload): Promise<AdCallResult> {
    const userData: Record<string, unknown> = {};
    if (payload.clickIds.fbclid)
      userData.fbc = metaFbc(payload.clickIds.fbclid, payload.clickedAt ?? payload.occurredAt);
    if (payload.hashedPhone) userData.ph = [payload.hashedPhone];
    if (payload.hashedEmail) userData.em = [payload.hashedEmail];
    const event: Record<string, unknown> = {
      event_name: AD_EVENT_NAMES.META[payload.type],
      event_time: Math.floor(payload.occurredAt.getTime() / 1000),
      event_id: payload.eventId,
      action_source: 'website',
      user_data: userData,
    };
    if (payload.landingUrl) event.event_source_url = payload.landingUrl;
    if (payload.valueMinor !== null && payload.currency) {
      event.custom_data = {
        value: Number(minorToDecimalString(payload.valueMinor, payload.digits)),
        currency: payload.currency,
      };
    }
    const res = await this.call(`${GRAPH}/${encodeURIComponent(credentials.pixelId)}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        data: [event],
        access_token: credentials.accessToken,
        ...(credentials.testEventCode ? { test_event_code: credentials.testEventCode } : {}),
      }),
    });
    if (!res) return fail('NETWORK', true);
    return res.status === 200 ? OK : this.failure(res.status, res.body);
  }

  async fetchSpend(
    credentials: Record<string, string>,
    from: string,
    to: string,
    fallbackCurrency: string,
    digitsOf: (currency: string) => number,
  ): Promise<AdSpendRow[]> {
    if (!credentials.adAccountId) return [];
    const account = credentials.adAccountId.replace(/^act_/, '');
    const params = new URLSearchParams({
      level: 'campaign',
      time_increment: '1',
      time_range: JSON.stringify({ since: from, until: to }),
      fields: 'campaign_id,campaign_name,spend,impressions,clicks,account_currency',
      limit: '500',
      access_token: credentials.accessToken,
    });
    const res = await this.call(`${GRAPH}/act_${encodeURIComponent(account)}/insights?${params.toString()}`);
    if (!res || res.status !== 200) return [];
    const rows = (res.body as { data?: Record<string, string>[] } | null)?.data ?? [];
    return rows.map((r) => {
      const currency = r.account_currency || fallbackCurrency;
      return {
        date: r.date_start,
        campaignRef: r.campaign_id,
        campaignName: r.campaign_name ?? null,
        spendMinor: decimalToMinor(r.spend ?? '0', digitsOf(currency)),
        currency,
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
      };
    });
  }
}
