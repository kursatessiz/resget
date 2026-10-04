import { MetaAdsAdapter } from './meta.adapter';
import { TikTokAdsAdapter } from './tiktok.adapter';
import { GoogleAdsAdapter, googleDateTime } from './google.adapter';
import type { AdConversionPayload } from './ads.adapter';

const payload: AdConversionPayload = {
  eventId: 'evt-1',
  type: 'first_order',
  occurredAt: new Date('2026-10-04T12:30:00Z'),
  valueMinor: 12_550,
  currency: 'TRY',
  digits: 2,
  clickIds: { fbclid: 'FB1', gclid: 'G1', ttclid: 'TT1' },
  clickedAt: new Date('2026-10-04T12:00:00Z'),
  landingUrl: 'https://lokanta.test/m/abc',
  hashedPhone: null,
  hashedEmail: 'e'.repeat(64),
  countryCode: 'TR',
};

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('ad platform adapters', () => {
  let fetchSpy: jest.SpyInstance;
  afterEach(() => fetchSpy.mockRestore());

  it('sends a Meta purchase with the click id, value and the shared event id', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(respond(200, { events_received: 1 }));
    const result = await new MetaAdsAdapter().sendConversion({ pixelId: 'PX', accessToken: 'TOK' }, payload);
    expect(result.ok).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/PX/events');
    const body = JSON.parse(String(init.body)) as { data: Record<string, unknown>[]; access_token: string };
    expect(body.access_token).toBe('TOK');
    expect(body.data[0]).toMatchObject({
      event_name: 'Purchase',
      event_id: 'evt-1',
      event_time: 1_791_117_000,
      action_source: 'website',
      custom_data: { value: 125.5, currency: 'TRY' },
      user_data: { fbc: 'fb.1.1791115200000.FB1', em: ['e'.repeat(64)] },
    });
  });

  it('treats an expired Meta token as refused credentials', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(respond(400, { error: { code: 190 } }));
    const result = await new MetaAdsAdapter().sendConversion({ pixelId: 'PX', accessToken: 'TOK' }, payload);
    expect(result).toMatchObject({ ok: false, authFailed: true, errorCode: 'CREDENTIALS_REFUSED' });
  });

  it('reads TikTok answers by their own code', async () => {
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(respond(200, { code: 0 }))
      .mockResolvedValueOnce(respond(200, { code: 40105 }))
      .mockResolvedValueOnce(respond(503, {}));
    const adapter = new TikTokAdsAdapter();
    const creds = { pixelCode: 'TP', accessToken: 'TT' };
    expect((await adapter.sendConversion(creds, payload)).ok).toBe(true);
    const sent = JSON.parse(String((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body)) as {
      event_source_id: string;
      data: Record<string, unknown>[];
    };
    expect(sent.event_source_id).toBe('TP');
    expect(sent.data[0]).toMatchObject({ event: 'CompletePayment', event_id: 'evt-1', user: { ttclid: 'TT1' } });
    expect(await adapter.sendConversion(creds, payload)).toMatchObject({ ok: false, authFailed: true });
    expect(await adapter.sendConversion(creds, payload)).toMatchObject({ ok: false, retryable: true });
  });

  it('uploads a Google click conversion and reports a partial failure', async () => {
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(respond(200, { access_token: 'AT' }))
      .mockResolvedValueOnce(respond(200, { results: [{}] }))
      .mockResolvedValueOnce(respond(200, { access_token: 'AT' }))
      .mockResolvedValueOnce(respond(200, { partialFailureError: { code: 3 } }));
    const adapter = new GoogleAdsAdapter({ clientId: 'c', clientSecret: 's', developerToken: 'd' });
    const creds = { customerId: '123-456-7890', conversionActionId: '99', refreshToken: 'R' };
    expect((await adapter.sendConversion(creds, payload)).ok).toBe(true);
    const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://googleads.googleapis.com/v18/customers/1234567890:uploadClickConversions');
    expect((init.headers as Record<string, string>)['developer-token']).toBe('d');
    const body = JSON.parse(String(init.body)) as { conversions: Record<string, unknown>[] };
    expect(body.conversions[0]).toMatchObject({
      gclid: 'G1',
      conversionAction: 'customers/1234567890/conversionActions/99',
      conversionDateTime: '2026-10-04 12:30:00+00:00',
      conversionValue: 125.5,
      currencyCode: 'TRY',
      orderId: 'evt-1',
    });
    expect(await adapter.sendConversion(creds, payload)).toMatchObject({
      ok: false,
      errorCode: 'GOOGLE_PARTIAL_FAILURE',
    });
    expect(googleDateTime(new Date('2026-01-02T03:04:05.678Z'))).toBe('2026-01-02 03:04:05+00:00');
  });

  it('refuses Google calls when the app credentials are not configured', async () => {
    fetchSpy = jest.spyOn(global, 'fetch');
    const result = await new GoogleAdsAdapter({}).verify({
      customerId: '1',
      conversionActionId: '2',
      refreshToken: 'r',
    });
    expect(result).toMatchObject({ ok: false, errorCode: 'GOOGLE_ADS_NOT_CONFIGURED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
