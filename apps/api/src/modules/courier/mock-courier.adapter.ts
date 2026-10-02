import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  CourierDispatch,
  CourierEvent,
  CourierProviderAdapter,
  CourierQuote,
  CourierQuoteRequest,
} from '@resget/shared';

/** Flat fee plus a distance component, so quotes vary and tests can assert on them. */
export const MOCK_BASE_FEE_MINOR = 3500;
export const MOCK_PER_KM_MINOR = 800;
export const MOCK_QUOTE_TTL_SECONDS = 300;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Deterministic in-memory courier network for development and tests. A real
 * network adapter implements the same interface with HTTP calls and a signed
 * webhook; nothing else in the platform changes.
 */
export class MockCourierAdapter implements CourierProviderAdapter {
  readonly code = 'MOCK';
  private readonly quotes = new Map<string, CourierQuote>();

  constructor(private readonly webhookSecret: string = 'mock-courier-secret') {}

  async quote(request: CourierQuoteRequest): Promise<CourierQuote> {
    const km = haversineKm(request.pickup.point, request.dropoff.point);
    const quote: CourierQuote = {
      providerCode: this.code,
      quoteId: randomUUID(),
      feeMinor: MOCK_BASE_FEE_MINOR + Math.round(km * MOCK_PER_KM_MINOR),
      currency: request.currency,
      pickupEtaMinutes: 10,
      dropoffEtaMinutes: 10 + Math.ceil(km * 4),
      expiresAt: new Date(Date.now() + MOCK_QUOTE_TTL_SECONDS * 1000).toISOString(),
    };
    this.quotes.set(quote.quoteId, quote);
    return quote;
  }

  async dispatch(quoteId: string, orderRef: string): Promise<CourierDispatch> {
    const quote = this.quotes.get(quoteId);
    if (!quote) throw new Error('Unknown or expired quote');
    return { providerCode: this.code, providerRef: `mock-${orderRef}`, trackingUrl: null };
  }

  async cancel(): Promise<void> {
    return;
  }

  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): CourierEvent {
    const signature = headers['x-mock-signature'] ?? '';
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Bad webhook signature');
    const payload = JSON.parse(rawBody) as CourierEvent;
    return payload;
  }
}
