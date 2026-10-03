import type { GeoPoint } from './courier';

/**
 * Address geocoding (docs/VITRIN.md, "Adres geokodlama"): turns a typed
 * address into a point so a courier network can quote and the dispatch
 * board can route the stop. It is best effort everywhere: an address that
 * cannot be placed stays without a point and the order goes through as
 * before. Providers sit behind one adapter; the platform never assumes a
 * country or a map vendor.
 */

export const GEOCODER_PROVIDERS = ['NONE', 'MOCK', 'NOMINATIM'] as const;
export type GeocoderProvider = (typeof GEOCODER_PROVIDERS)[number];

export interface GeocodeQuery {
  addressLine: string;
  district: string;
  city: string;
  postalCode?: string | null;
  /** ISO 3166-1 alpha-2 of the restaurant's country; narrows the search when known. */
  countryCode: string | null;
  /** A nearby known point (the branch) that biases ambiguous matches; the mock places results around it. */
  near: GeoPoint | null;
}

/** How exact the match is; only ROOFTOP and STREET are precise enough to route a courier to. */
export type GeocodePrecision = 'ROOFTOP' | 'STREET' | 'AREA';

export interface GeocodeResult {
  point: GeoPoint;
  precision: GeocodePrecision;
  /** The provider's own description of the match, for logs and support. */
  label: string;
}

export interface GeocoderAdapter {
  readonly code: GeocoderProvider;
  geocode(query: GeocodeQuery): Promise<GeocodeResult | null>;
}

/** The free-text form providers search for: street first, then district, city and postal code. */
export function geocodeQueryText(query: GeocodeQuery): string {
  return [query.addressLine, query.district, query.city, query.postalCode ?? '']
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

/** Normalised cache key: case and whitespace do not make a different address. */
export function geocodeCacheKey(query: GeocodeQuery): string {
  return `${query.countryCode ?? ''}|${geocodeQueryText(query).toLowerCase().replace(/\s+/g, ' ')}`;
}

/** A routeable result; AREA matches (a district centroid) would mislead the courier and are dropped. */
export function routeablePoint(result: GeocodeResult | null): GeoPoint | null {
  return result && result.precision !== 'AREA' ? result.point : null;
}
