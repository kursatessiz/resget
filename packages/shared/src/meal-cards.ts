import { z } from 'zod';
import { PaymentMethod, PaymentMode } from './enums';
import type { PaymentModeValue } from './payments';
import type { GatewayWebhookEvent, HostedCheckoutSession } from './payments';
import { UuidSchema } from './validators';

/**
 * Meal cards (docs/YEMEK_KARTI.md): Multinet, Edenred, Pluxee, Setcard,
 * Metropol, Yemekmatik, Paye, Tokenflex and the next one.
 *
 * Rules that do not change:
 * - The restaurant is the member merchant of each card issuer, never the
 *   platform: a meal card may only pay for food at the member restaurant,
 *   so the money goes to the restaurant's own issuer account. The platform
 *   invoices its commission on the order like in OWN_POS, whatever the
 *   restaurant's card payment mode is (effectivePaymentModeFor).
 * - Every issuer is an adapter behind MealCardAdapter; the order flow only
 *   sees the interface. Issuer credentials are encrypted at rest and never
 *   returned by the API.
 * - A card can be accepted ONLINE (the customer pays on the issuer's hosted
 *   page or with its OTP flow at checkout) and/or ON_DELIVERY (the physical
 *   card at the door, recorded by the courier or the counter). On-delivery
 *   acceptance needs no credentials and no adapter.
 */

export type PaymentMethodValue = `${PaymentMethod}`;

export interface MealCardProviderSpec {
  /** Brand name as the issuer writes it; tenant-facing and never translated. */
  name: string;
  /** Country the issuer operates in (ISO 3166-1 alpha-2). */
  countryCode: string;
  /** Credential fields of the issuer's online payment API; final names come from each issuer's documentation. */
  fields: readonly string[];
  optionalFields: readonly string[];
}

export const MEAL_CARD_PROVIDERS = {
  MULTINET: {
    name: 'Multinet',
    countryCode: 'TR',
    fields: ['merchantId', 'apiKey', 'apiSecret'],
    optionalFields: ['terminalId'],
  },
  EDENRED: { name: 'Edenred', countryCode: 'TR', fields: ['merchantId', 'apiKey', 'apiSecret'], optionalFields: [] },
  PLUXEE: { name: 'Pluxee', countryCode: 'TR', fields: ['merchantId', 'apiKey', 'apiSecret'], optionalFields: [] },
  SETCARD: { name: 'Setcard', countryCode: 'TR', fields: ['merchantId', 'apiKey', 'apiSecret'], optionalFields: [] },
  METROPOL: { name: 'Metropol', countryCode: 'TR', fields: ['merchantId', 'apiKey', 'apiSecret'], optionalFields: [] },
  YEMEKMATIK: {
    name: 'Yemekmatik',
    countryCode: 'TR',
    fields: ['merchantId', 'apiKey', 'apiSecret'],
    optionalFields: [],
  },
  PAYE: { name: 'Paye', countryCode: 'TR', fields: ['merchantId', 'apiKey', 'apiSecret'], optionalFields: [] },
  TOKENFLEX: {
    name: 'Tokenflex',
    countryCode: 'TR',
    fields: ['merchantId', 'apiKey', 'apiSecret'],
    optionalFields: [],
  },
  MOCK: { name: 'Test kart', countryCode: 'XX', fields: ['merchantId'], optionalFields: ['apiSecret'] },
} as const satisfies Record<string, MealCardProviderSpec>;

export type MealCardProviderCode = keyof typeof MEAL_CARD_PROVIDERS;
export const MEAL_CARD_PROVIDER_CODES = Object.keys(MEAL_CARD_PROVIDERS) as MealCardProviderCode[];
export const MealCardProviderCodeSchema = z.enum(
  MEAL_CARD_PROVIDER_CODES as [MealCardProviderCode, ...MealCardProviderCode[]],
);

export function isMealCardProviderCode(value: string): value is MealCardProviderCode {
  return (MEAL_CARD_PROVIDER_CODES as readonly string[]).includes(value);
}

/** Issuers available to a restaurant: those of its country plus the development issuer outside production. */
export function mealCardProvidersFor(countryCode: string, includeMock: boolean): MealCardProviderCode[] {
  return MEAL_CARD_PROVIDER_CODES.filter((code) => {
    const spec = MEAL_CARD_PROVIDERS[code];
    if (code === 'MOCK') return includeMock;
    return spec.countryCode === countryCode.toUpperCase();
  });
}

// -- Connections ----------------------------------------------------------------------

const CredentialValue = z.string().trim().min(1).max(512);

/**
 * How a restaurant accepts one issuer's cards. Online acceptance needs the
 * issuer's API credentials (verified and encrypted); on-delivery acceptance
 * is a plain flag.
 */
export const UpsertMealCardConnectionSchema = z
  .object({
    providerCode: MealCardProviderCodeSchema,
    acceptsOnline: z.boolean().default(false),
    acceptsOnDelivery: z.boolean().default(true),
    credentials: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,40}$/), CredentialValue).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.acceptsOnline && !value.acceptsOnDelivery) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['acceptsOnDelivery'],
        message: 'accept online or on delivery',
      });
    }
    if (!value.acceptsOnline) return;
    const spec = MEAL_CARD_PROVIDERS[value.providerCode];
    const credentials = value.credentials ?? {};
    const allowed = new Set<string>([...spec.fields, ...spec.optionalFields]);
    for (const field of spec.fields) {
      if (!credentials[field])
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['credentials', field], message: 'required' });
    }
    for (const key of Object.keys(credentials)) {
      if (!allowed.has(key))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['credentials', key], message: 'unknown field' });
    }
  });
export type UpsertMealCardConnectionInput = z.infer<typeof UpsertMealCardConnectionSchema>;

export interface MealCardConnectionDTO {
  providerCode: MealCardProviderCode;
  name: string;
  acceptsOnline: boolean;
  acceptsOnDelivery: boolean;
  /** Online credential status; ACTIVE only after the issuer verified them. DISABLED when online acceptance is off. */
  status: string;
  /** Masked identification, e.g. "Multinet ****4821"; never the credentials. */
  label: string | null;
  lastVerifiedAt: string | null;
  failureReason: string | null;
}

/** What a checkout screen may offer for a restaurant. Public: carries no credentials or ids. */
export interface AcceptedPaymentMethodsDTO {
  /** Card on the restaurant's own POS or the platform's PSP. */
  onlineCard: boolean;
  /** Issuers whose cards can be paid online at checkout. */
  mealCardsOnline: { providerCode: MealCardProviderCode; name: string }[];
  cashOnDelivery: boolean;
  cardOnDelivery: boolean;
  /** Issuers whose physical cards are taken at the door. */
  mealCardsOnDelivery: { providerCode: MealCardProviderCode; name: string }[];
}

// -- Choosing a method for an order -----------------------------------------------------

export const PaymentMethodValueSchema = z.enum(
  Object.values(PaymentMethod) as unknown as [PaymentMethodValue, ...PaymentMethodValue[]],
);

/** The payment the customer (or the staff on their behalf) chose when placing the order. */
export const OrderPaymentIntentSchema = z
  .object({
    method: PaymentMethodValueSchema,
    /** Issuer for MEAL_CARD; ignored for the other methods. */
    providerCode: MealCardProviderCodeSchema.optional(),
    /** MEAL_CARD only: hand the physical card to the courier instead of paying online now. */
    atDoor: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.method === 'MEAL_CARD' && !value.providerCode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['providerCode'], message: 'required for a meal card' });
    }
  });
export type OrderPaymentIntent = z.infer<typeof OrderPaymentIntentSchema>;

/** Methods settled when the customer pays before the kitchen starts; the order waits in PENDING_PAYMENT. */
export const ONLINE_PAYMENT_METHODS: readonly PaymentMethodValue[] = ['ONLINE_CARD'];
/** Methods collected at the door or the counter; the order is PLACED at once and the payment is recorded later. */
export const ON_DELIVERY_PAYMENT_METHODS: readonly PaymentMethodValue[] = ['CASH_ON_DELIVERY', 'CARD_ON_DELIVERY'];

/** Whether an order with this intent starts in PENDING_PAYMENT (online) or PLACED (paid on delivery). */
export function isPaidBeforePlacement(intent: OrderPaymentIntent, mealCardOnline: boolean): boolean {
  if (intent.method === 'MEAL_CARD') return mealCardOnline && !intent.atDoor;
  return ONLINE_PAYMENT_METHODS.includes(intent.method);
}

/** One issuer as the payment settings screen lists it. */
export interface MealCardCatalogEntryDTO {
  providerCode: MealCardProviderCode;
  name: string;
  /** True when the platform has an adapter for the issuer's online payment API. */
  onlineAvailable: boolean;
}

export interface MealCardSettingsDTO {
  catalog: MealCardCatalogEntryDTO[];
  connections: MealCardConnectionDTO[];
}

/**
 * Which settlement mode an order follows. Only an online card payment can
 * be collected by the platform's PSP; cash, card at the door and every
 * meal card are collected by the restaurant itself, so they settle like
 * OWN_POS (commission invoiced, no PSP fee or withholding at the platform)
 * even for a PLATFORM_PSP restaurant.
 */
export function effectivePaymentModeFor(
  method: PaymentMethodValue | null | undefined,
  restaurantMode: PaymentModeValue,
): PaymentModeValue {
  if (method === 'ONLINE_CARD' || method === null || method === undefined) return restaurantMode;
  return PaymentMode.OWN_POS;
}

export const CheckoutRequestSchema = z.object({ returnUrl: z.string().url() }).strict();

export const CollectPaymentSchema = z
  .object({
    method: z.enum(['CASH_ON_DELIVERY', 'CARD_ON_DELIVERY', 'MEAL_CARD']),
    providerCode: MealCardProviderCodeSchema.optional(),
    /** Defaults to what the order charges; a smaller amount records a partial collection. */
    amountMinor: z.number().int().positive().optional(),
    /** Issuer slip or POS receipt number when there is one. */
    reference: z.string().trim().max(80).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.method === 'MEAL_CARD' && !value.providerCode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['providerCode'], message: 'required for a meal card' });
    }
  });
export type CollectPaymentInput = z.infer<typeof CollectPaymentSchema>;

export interface OrderPaymentDTO {
  method: PaymentMethodValue | null;
  providerCode: string | null;
  /** PENDING until collected or captured; CAPTURED once the money is with the restaurant (or the PSP). */
  status: string | null;
  /** What still has to be collected at the door, 0 for a paid order. */
  dueMinor: number;
  capturedAt: string | null;
}

export interface CheckoutSessionDTO {
  paymentId: string;
  session: HostedCheckoutSession;
}

export const WebhookRouteSchema = z.object({ connectionId: UuidSchema }).strict();

/**
 * One meal card issuer. Same shape as a payment gateway: hosted checkout
 * in, signed webhook out, refund when the issuer supports it.
 */
export interface MealCardAdapter {
  readonly code: MealCardProviderCode;
  verifyCredentials(credentials: Record<string, string>): Promise<{ ok: boolean; label: string; reason?: string }>;
  createHostedCheckout(
    credentials: Record<string, string>,
    params: { orderRef: string; amountMinor: number; currency: string; returnUrl: string; customerPhone: string },
  ): Promise<HostedCheckoutSession>;
  refund(
    credentials: Record<string, string>,
    providerRef: string,
    amountMinor: number,
  ): Promise<{ ok: boolean; providerRef: string | null }>;
  parseWebhook(
    credentials: Record<string, string>,
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): GatewayWebhookEvent;
}
