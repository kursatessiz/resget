import { Inject, Injectable, Logger } from '@nestjs/common';
import { geocodeCacheKey, routeablePoint } from '@resget/shared';
import type { GeoPoint, GeocodeQuery, GeocoderAdapter } from '@resget/shared';
import { GEOCODER } from './geocoders';

/** Answers are kept for a day; the same address is typed again by the same customers. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;
/** Minimum spacing between provider calls; the public Nominatim policy is one request per second. */
const MIN_SPACING_MS = 1100;

interface AddressLike {
  addressLine: string;
  district: string;
  city: string;
  postalCode?: string | null;
}

/**
 * Best-effort geocoding (docs/VITRIN.md). Never throws into an order flow:
 * a provider error or an imprecise match leaves the point null and the
 * order proceeds exactly as it did before geocoding existed.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly cache = new Map<string, { point: GeoPoint | null; until: number }>();
  private chain: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;

  constructor(@Inject(GEOCODER) private readonly geocoder: GeocoderAdapter | null) {}

  get enabled(): boolean {
    return this.geocoder !== null;
  }

  /** A routeable point for the address, or null; cached and rate-spaced per process. */
  async pointFor(address: AddressLike, countryCode: string | null, near: GeoPoint | null): Promise<GeoPoint | null> {
    if (!this.geocoder) return null;
    const query: GeocodeQuery = {
      addressLine: address.addressLine,
      district: address.district,
      city: address.city,
      postalCode: address.postalCode ?? null,
      countryCode,
      near,
    };
    const key = geocodeCacheKey(query);
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.point;
    const point = await this.serialised(async () => {
      try {
        return routeablePoint(await this.geocoder!.geocode(query));
      } catch (error) {
        this.logger.warn(`geocoding failed (${this.geocoder!.code}): ${(error as Error).message}`);
        return null;
      }
    });
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(key, { point, until: Date.now() + CACHE_TTL_MS });
    return point;
  }

  /** One provider call at a time with a minimum gap; the mock needs none of this but it costs nothing. */
  private serialised<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      if (this.geocoder?.code !== 'MOCK') {
        const wait = this.lastCallAt + MIN_SPACING_MS - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
      this.lastCallAt = Date.now();
      return run();
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}
