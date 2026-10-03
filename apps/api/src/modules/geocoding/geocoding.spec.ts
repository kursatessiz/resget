import { MockGeocoder, NominatimGeocoder } from './geocoders';
import { GeocodingService } from './geocoding.service';

const query = {
  addressLine: 'Moda Cad. No 10',
  district: 'Kadikoy',
  city: 'Istanbul',
  postalCode: null,
  countryCode: 'TR',
  near: { lat: 40.9867, lng: 29.0263 },
};

describe('geocoders', () => {
  it('the mock places the same address at the same point near the bias, and nowhere without one', async () => {
    const mock = new MockGeocoder();
    const first = await mock.geocode(query);
    const second = await mock.geocode({ ...query, addressLine: '  moda cad. no 10 ' });
    expect(first).not.toBeNull();
    expect(second?.point).toEqual(first?.point);
    expect(Math.abs(first!.point.lat - query.near.lat)).toBeLessThan(0.01);
    expect(await mock.geocode({ ...query, near: null })).toBeNull();
  });

  it('nominatim builds the search, sends the agent header, and grades the match', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(input), headers: init?.headers as Record<string, string> });
      return new Response(
        JSON.stringify([
          { lat: '40.9870', lon: '29.0270', category: 'highway', type: 'residential', display_name: 'Moda' },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const adapter = new NominatimGeocoder('https://geo.example.test', 'Resget/test (+https://app.test)', fetchImpl);
    const result = await adapter.geocode(query);
    expect(result).toEqual({ point: { lat: 40.987, lng: 29.027 }, precision: 'STREET', label: 'Moda' });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('Moda Cad. No 10, Kadikoy, Istanbul');
    expect(url.searchParams.get('countrycodes')).toBe('tr');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(calls[0].headers['user-agent']).toContain('Resget/test');

    const empty = new NominatimGeocoder(
      'https://geo.example.test',
      'ua',
      (async () => new Response('[]', { status: 200 })) as typeof fetch,
    );
    expect(await empty.geocode(query)).toBeNull();
  });
});

describe('GeocodingService', () => {
  it('drops area matches, swallows provider errors, and caches by normalised address', async () => {
    let calls = 0;
    const adapter = {
      code: 'NOMINATIM' as const,
      geocode: async () => {
        calls += 1;
        if (calls === 1) return { point: { lat: 1, lng: 2 }, precision: 'AREA' as const, label: 'district' };
        throw new Error('boom');
      },
    };
    const service = new GeocodingService(adapter);
    expect(await service.pointFor(query, 'TR', null)).toBeNull();
    // Cached: the second lookup of the same text does not reach the provider.
    expect(await service.pointFor({ ...query, addressLine: 'MODA CAD.  No 10' }, 'TR', null)).toBeNull();
    expect(calls).toBe(1);
    expect(await service.pointFor({ ...query, addressLine: 'Other 5' }, 'TR', null)).toBeNull();
    expect(calls).toBe(2);
    expect(new GeocodingService(null).enabled).toBe(false);
  });
});
