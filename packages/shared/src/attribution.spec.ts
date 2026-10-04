import {
  aggregateAttribution,
  attributeConversion,
  consentRegimeFor,
  decodeConsent,
  detectAdPlatform,
  deviceTypeOf,
  effectiveConsent,
  encodeConsent,
  hasTrackingParams,
  isBotUserAgent,
  isUntaggedPaidTraffic,
  parseTrackingParams,
  touchpointKey,
  visitorCountry,
} from './attribution';
import type { AttributableTouchpoint, QueryParams } from './attribution';

/** A query string reader; shared code compiles without the DOM library, so no URLSearchParams here. */
function query(search: string): QueryParams {
  const pairs = new Map<string, string>();
  for (const part of search.split('&')) {
    const [key, value = ''] = part.split('=');
    if (key) pairs.set(decodeURIComponent(key), decodeURIComponent(value));
  }
  return { get: (key) => pairs.get(key) ?? null, has: (key) => pairs.has(key) };
}

const day = 86_400_000;
const at = (offsetDays: number) => new Date(Date.UTC(2026, 9, 1) + offsetDays * day);

function tp(id: string, offsetDays: number, extra: Partial<AttributableTouchpoint> = {}): AttributableTouchpoint {
  return {
    id,
    occurredAt: at(offsetDays),
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmId: null,
    campaignId: null,
    adPlatform: null,
    referrerHost: null,
    tableId: null,
    ...extra,
  };
}

describe('consent', () => {
  it('maps regions to regimes, strictest when unknown', () => {
    expect(consentRegimeFor('TR')).toBe('KVKK');
    expect(consentRegimeFor('de')).toBe('OPT_IN');
    expect(consentRegimeFor('GB')).toBe('OPT_IN');
    expect(consentRegimeFor('CA')).toBe('OPT_IN');
    expect(consentRegimeFor('US')).toBe('NOTICE');
    expect(consentRegimeFor(null)).toBe('OPT_IN');
    expect(consentRegimeFor('XYZ')).toBe('OPT_IN');
  });

  it('reads the country from the edge header, then the language region', () => {
    expect(visitorCountry('tr', 'en-US')).toBe('TR');
    expect(visitorCountry('XX', 'de-DE,de;q=0.9')).toBe('DE');
    expect(visitorCountry(null, 'tr-TR')).toBe('TR');
    expect(visitorCountry(null, 'tr')).toBeNull();
    expect(visitorCountry(undefined, undefined)).toBeNull();
  });

  it('encodes a choice and never advertising without analytics', () => {
    expect(encodeConsent({ analytics: true, advertising: true })).toBe('1.1.1');
    expect(encodeConsent({ analytics: false, advertising: true })).toBe('1.0.0');
    expect(decodeConsent('1.1.0')).toEqual({ analytics: true, advertising: false });
    expect(decodeConsent('1.0.1')).toEqual({ analytics: false, advertising: false });
    expect(decodeConsent('0.1.1')).toBeNull();
    expect(decodeConsent('garbage')).toBeNull();
    expect(decodeConsent(null)).toBeNull();
  });

  it('measures before a choice only in the notice regime; GPC turns advertising off', () => {
    expect(effectiveConsent('OPT_IN', null, false)).toEqual({ analytics: false, advertising: false });
    expect(effectiveConsent('KVKK', null, false)).toEqual({ analytics: false, advertising: false });
    expect(effectiveConsent('NOTICE', null, false)).toEqual({ analytics: true, advertising: true });
    expect(effectiveConsent('NOTICE', null, true)).toEqual({ analytics: true, advertising: false });
    expect(effectiveConsent('OPT_IN', { analytics: true, advertising: true }, true)).toEqual({
      analytics: true,
      advertising: false,
    });
    expect(effectiveConsent('NOTICE', { analytics: false, advertising: false }, false).analytics).toBe(false);
  });
});

describe('tracking parameters', () => {
  it('keeps tracking parameters and drops everything else', () => {
    const params = parseTrackingParams(
      query('utm_source=Google&utm_medium=CPC&utm_campaign=Kadikoy&gclid=abc&rg_cid=c1&email=x@y.z'),
    );
    expect(params.utmSource).toBe('google');
    expect(params.utmMedium).toBe('cpc');
    expect(params.utmCampaign).toBe('Kadikoy');
    expect(params.campaignId).toBe('c1');
    expect(params.clickIds).toEqual({ gclid: 'abc' });
    expect(params.adPlatform).toBe('GOOGLE');
    expect(JSON.stringify(params)).not.toContain('x@y.z');
  });

  it('detects the ad platform from click ids first, then the source', () => {
    expect(detectAdPlatform({ fbclid: '1' }, 'google')).toBe('META');
    expect(detectAdPlatform({}, 'instagram')).toBe('META');
    expect(detectAdPlatform({}, 'newsletter')).toBeNull();
  });

  it('flags paid clicks without our campaign and ad set ids', () => {
    expect(isUntaggedPaidTraffic({ clickIds: { gclid: 'a' }, campaignId: 'c', adsetId: null })).toBe(true);
    expect(isUntaggedPaidTraffic({ clickIds: { gclid: 'a' }, campaignId: 'c', adsetId: 's' })).toBe(false);
    expect(isUntaggedPaidTraffic({ clickIds: {}, campaignId: null, adsetId: null })).toBe(false);
  });

  it('knows when a URL is worth a touchpoint mid-session', () => {
    expect(hasTrackingParams(query('utm_source=x'))).toBe(true);
    expect(hasTrackingParams(query('ttclid=1'))).toBe(true);
    expect(hasTrackingParams(query('page=2'))).toBe(false);
  });

  it('classifies devices and bots', () => {
    expect(deviceTypeOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('MOBILE');
    expect(deviceTypeOf('Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36')).toBe('TABLET');
    expect(deviceTypeOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0')).toBe('DESKTOP');
    expect(isBotUserAgent('Googlebot/2.1')).toBe(true);
    expect(isBotUserAgent('curl/8.0')).toBe(true);
    expect(isBotUserAgent('WhatsApp/2.23')).toBe(true);
    expect(isBotUserAgent('')).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0')).toBe(false);
  });
});

describe('attribution', () => {
  const qr = tp('qr', -40, { tableId: 'table-1' });
  const ad = tp('ad', -10, { adPlatform: 'GOOGLE', campaignId: 'c1', utmCampaign: 'Old name' });
  const mail = tp('mail', -2, { utmSource: 'newsletter', utmMedium: 'email' });
  const later = tp('later', 3, { utmSource: 'late' });
  const all = [mail, later, qr, ad];

  it('keys touchpoints by source, medium and campaign, ids before names', () => {
    expect(touchpointKey(qr, 'source')).toBe('qr');
    expect(touchpointKey(qr, 'medium')).toBe('table');
    expect(touchpointKey(ad, 'source')).toBe('google');
    expect(touchpointKey(ad, 'medium')).toBe('cpc');
    expect(touchpointKey(ad, 'campaign')).toBe('c1');
    expect(touchpointKey(tp('ref', 0, { referrerHost: 'blog.example' }), 'medium')).toBe('referral');
    expect(touchpointKey(null, 'source')).toBe('(direct)');
    expect(touchpointKey(null, 'campaign')).toBe('(none)');
  });

  it('credits the last touch within the window, the first ever, or splits evenly', () => {
    const conversionAt = at(0);
    expect(attributeConversion('LAST_TOUCH', all, conversionAt)[0].touchpoint?.id).toBe('mail');
    expect(attributeConversion('FIRST_TOUCH', all, conversionAt)[0].touchpoint?.id).toBe('qr');
    const linear = attributeConversion('LINEAR', all, conversionAt);
    expect(linear.map((c) => c.touchpoint?.id)).toEqual(['ad', 'mail']);
    expect(linear.every((c) => c.part === 1 && c.whole === 2)).toBe(true);
  });

  it('is direct when nothing falls in the window', () => {
    expect(attributeConversion('LAST_TOUCH', [qr], at(0))[0].touchpoint).toBeNull();
    expect(attributeConversion('LINEAR', [], at(0))).toEqual([{ touchpoint: null, part: 1, whole: 1 }]);
    expect(attributeConversion('FIRST_TOUCH', [later], at(0))[0].touchpoint).toBeNull();
  });

  it('aggregates counts and splits revenue in minor units without losing a cent', () => {
    const { rows, totals } = aggregateAttribution(
      [
        { type: 'first_order', occurredAt: at(0), valueMinor: 1001, currency: 'EUR', touchpoints: all },
        { type: 'repeat_order', occurredAt: at(1), valueMinor: 500, currency: 'EUR', touchpoints: [] },
      ],
      'LINEAR',
      'source',
    );
    expect(totals.conversions).toEqual({ first_order: 1, repeat_order: 1 });
    expect(totals.revenue).toEqual([{ currency: 'EUR', minor: 1501 }]);
    const google = rows.find((r) => r.key === 'google');
    const newsletter = rows.find((r) => r.key === 'newsletter');
    const direct = rows.find((r) => r.key === '(direct)');
    expect(google?.conversions.first_order).toBe(0.5);
    expect(newsletter?.conversions.first_order).toBe(0.5);
    expect(direct?.conversions.repeat_order).toBe(1);
    const split = (google?.revenue[0].minor ?? 0) + (newsletter?.revenue[0].minor ?? 0);
    expect(Math.abs(split - 1001)).toBeLessThanOrEqual(1);
  });

  it('orders rows by credited conversions', () => {
    const { rows } = aggregateAttribution(
      [
        { type: 'first_order', occurredAt: at(0), valueMinor: null, currency: null, touchpoints: [mail] },
        { type: 'repeat_order', occurredAt: at(0), valueMinor: null, currency: null, touchpoints: [mail] },
        { type: 'first_order', occurredAt: at(0), valueMinor: null, currency: null, touchpoints: [ad] },
      ],
      'LAST_TOUCH',
      'source',
    );
    expect(rows.map((r) => r.key)).toEqual(['newsletter', 'google']);
  });
});
