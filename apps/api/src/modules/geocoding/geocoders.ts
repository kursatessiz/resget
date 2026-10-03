import { createHash } from 'node:crypto';
import { geocodeQueryText } from '@resget/shared';
import type { GeocodeQuery, GeocodeResult, GeocoderAdapter } from '@resget/shared';

export const GEOCODER = Symbol('GEOCODER');

/** Development and test stand-in: a deterministic point a few hundred metres from the bias point, or nothing. */
export class MockGeocoder implements GeocoderAdapter {
  readonly code = 'MOCK' as const;

  async geocode(query: GeocodeQuery): Promise<GeocodeResult | null> {
    if (!query.near) return null;
    const digest = createHash('sha256').update(geocodeQueryText(query).toLowerCase()).digest();
    // Up to about 900 metres in each direction, always the same for the same text.
    const dLat = ((digest[0] / 255) * 2 - 1) * 0.008;
    const dLng = ((digest[1] / 255) * 2 - 1) * 0.008;
    return {
      point: { lat: round(query.near.lat + dLat), lng: round(query.near.lng + dLng) },
      precision: 'STREET',
      label: `mock near ${query.near.lat},${query.near.lng}`,
    };
  }
}

/** Shape of the fields this adapter reads from a Nominatim `jsonv2` search result. */
interface NominatimHit {
  lat: string;
  lon: string;
  category?: string;
  class?: string;
  type?: string;
  display_name?: string;
}

/**
 * OpenStreetMap Nominatim (the public instance or a self-hosted one). The
 * public service wants a descriptive User-Agent and at most one request per
 * second; the service above this adapter spaces calls and caches answers.
 */
export class NominatimGeocoder implements GeocoderAdapter {
  readonly code = 'NOMINATIM' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly userAgent: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 2500,
  ) {}

  async geocode(query: GeocodeQuery): Promise<GeocodeResult | null> {
    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', geocodeQueryText(query));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    if (query.countryCode) url.searchParams.set('countrycodes', query.countryCode.toLowerCase());
    const response = await this.fetchImpl(url, {
      headers: { 'user-agent': this.userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Nominatim answered ${response.status}`);
    const hits = (await response.json()) as NominatimHit[];
    const hit = hits[0];
    if (!hit) return null;
    const lat = Number.parseFloat(hit.lat);
    const lng = Number.parseFloat(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { point: { lat, lng }, precision: precisionOf(hit), label: hit.display_name ?? '' };
  }
}

function precisionOf(hit: NominatimHit): GeocodeResult['precision'] {
  const category = hit.category ?? hit.class ?? '';
  const type = hit.type ?? '';
  if (category === 'building' || (category === 'place' && (type === 'house' || type === 'address'))) return 'ROOFTOP';
  if (type === 'house' || type === 'address' || category === 'amenity' || category === 'shop') return 'ROOFTOP';
  if (category === 'highway') return 'STREET';
  return 'AREA';
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
