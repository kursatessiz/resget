import { z } from 'zod';
import { CurrencyCodeSchema, MinorAmountSchema } from './money';

/**
 * Third-party courier integration (docs/KURYE.md).
 *
 * The platform never runs its own fleet. When a restaurant has no courier it
 * can hand a delivery to a courier network through that network's API. Two
 * rules are fixed:
 * - the courier fee is a separately priced service, shown as its own line to
 *   the customer or the restaurant, never folded into the 1 percent commission;
 * - every provider is an adapter behind this interface, chosen per country and
 *   per restaurant, so a new network is configuration, not a code path.
 */

export const GeoPointSchema = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
  .strict();
export type GeoPoint = z.infer<typeof GeoPointSchema>;

export const CourierStopSchema = z
  .object({
    address: z.string().trim().min(5).max(300),
    point: GeoPointSchema,
    contactName: z.string().trim().min(1).max(120),
    /** E.164. */
    contactPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type CourierStop = z.infer<typeof CourierStopSchema>;

export const CourierQuoteRequestSchema = z
  .object({
    restaurantId: z.string().uuid(),
    pickup: CourierStopSchema,
    dropoff: CourierStopSchema,
    /** Value of the parcel, for the provider's insurance and cash handling. */
    parcelValueMinor: MinorAmountSchema,
    currency: CurrencyCodeSchema,
    /** When the food will be ready; omitted means now. */
    readyAt: z.string().datetime().optional(),
  })
  .strict();
export type CourierQuoteRequest = z.infer<typeof CourierQuoteRequestSchema>;

export interface CourierQuote {
  providerCode: string;
  quoteId: string;
  feeMinor: number;
  currency: string;
  pickupEtaMinutes: number;
  dropoffEtaMinutes: number;
  /** ISO timestamp after which the quote must be requested again. */
  expiresAt: string;
}

export interface CourierDispatch {
  providerCode: string;
  providerRef: string;
  trackingUrl: string | null;
}

export type CourierEventKind = 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED' | 'FAILED';

export interface CourierEvent {
  providerRef: string;
  kind: CourierEventKind;
  occurredAt: string;
  /** Final fee when it differs from the quote (waiting time, distance correction). */
  finalFeeMinor?: number;
  reason?: string;
}

/** Everything a courier network must offer to be wired in. */
export interface CourierProviderAdapter {
  readonly code: string;
  quote(request: CourierQuoteRequest): Promise<CourierQuote>;
  dispatch(quoteId: string, orderRef: string): Promise<CourierDispatch>;
  cancel(providerRef: string): Promise<void>;
  /** Verifies the webhook signature and maps the payload; throws on a bad signature. */
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): CourierEvent;
  /** True when the network takes a customer's tip for the courier of a delivery (docs/BAHSIS.md). */
  readonly supportsTips?: boolean;
  /** Hands a tip to the courier of a dispatched delivery; the network bills the restaurant for it. */
  addTip?(providerRef: string, amountMinor: number, currency: string): Promise<{ providerRef: string }>;
}

// -- What the customer pays for delivery ---------------------------------------

/**
 * How the quoted courier fee turns into the delivery fee the customer sees.
 * The restaurant chooses; the platform's commission is unaffected either way.
 */
export const DeliveryFeePolicySchema = z.discriminatedUnion('mode', [
  /** Customer pays exactly the quote, rounded up to a step the restaurant likes (e.g. 500 = 5 TL). */
  z.object({ mode: z.literal('PASS_THROUGH'), roundUpToMinor: z.number().int().positive().optional() }).strict(),
  /** Customer always pays a fixed fee; the restaurant covers or keeps the difference. */
  z.object({ mode: z.literal('FIXED'), feeMinor: MinorAmountSchema }).strict(),
  /** Free delivery above a basket threshold, otherwise fixed. */
  z.object({ mode: z.literal('FREE_ABOVE'), thresholdMinor: MinorAmountSchema, feeMinor: MinorAmountSchema }).strict(),
]);
export type DeliveryFeePolicy = z.infer<typeof DeliveryFeePolicySchema>;

export function customerDeliveryFee(quoteFeeMinor: number, basketMinor: number, policy: DeliveryFeePolicy): number {
  switch (policy.mode) {
    case 'PASS_THROUGH': {
      const step = policy.roundUpToMinor ?? 1;
      return Math.ceil(quoteFeeMinor / step) * step;
    }
    case 'FIXED':
      return policy.feeMinor;
    case 'FREE_ABOVE':
      return basketMinor >= policy.thresholdMinor ? 0 : policy.feeMinor;
  }
}
