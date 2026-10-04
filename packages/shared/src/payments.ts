import { z } from 'zod';
import { LedgerEntryType, PaymentMode } from './enums';
import { BasisPointsSchema, bpsOf } from './money';
import { computeOrderSettlement } from './settlement';
import type { Settlement, SettlementInput } from './settlement';

/**
 * Payment modes and the card vault (docs/ODEME.md).
 *
 * Two merchants of record:
 * - OWN_POS (default): the restaurant connects its own virtual POS. The
 *   customer's money lands in the restaurant's bank account directly, the
 *   platform never holds it, and the platform invoices its commission (plus
 *   VAT) once a month and collects it from the restaurant's saved payment
 *   method. No payout, no withholding by the platform, no chargeback on the
 *   platform's balance sheet.
 * - PLATFORM_PSP: the platform's PSP (marketplace / sub-merchant product)
 *   collects; the commission, the PSP fee and the regional withholding are
 *   deducted and the rest is paid out to the restaurant.
 *
 * Cards: the platform never sees a card number. A customer's card is stored
 * by a vault provider (Masterpass or bex across merchants, the PSP's own
 * tokenization inside PLATFORM_PSP, the device wallets) and the platform
 * keeps only the provider's token, encrypted at rest. That keeps the
 * platform in the lightest PCI DSS scope (SAQ A) in both modes.
 */

export const PAYMENT_MODES = [PaymentMode.OWN_POS, PaymentMode.PLATFORM_PSP] as const;
export const DEFAULT_PAYMENT_MODE = PaymentMode.OWN_POS;

// -- Own POS connections -------------------------------------------------------

/**
 * Virtual POS providers a restaurant can connect, with the credential fields
 * each one needs. Credentials are encrypted before they are stored and never
 * returned by the API; the fields here only drive validation and the form.
 */
export const OWN_POS_PROVIDERS = {
  IYZICO: { name: 'iyzico', fields: ['apiKey', 'secretKey'], optionalFields: ['baseUrl'] },
  PAYTR: { name: 'PayTR', fields: ['merchantId', 'merchantKey', 'merchantSalt'], optionalFields: [] },
  PARAM: { name: 'Param', fields: ['clientCode', 'clientUsername', 'clientPassword', 'guid'], optionalFields: [] },
  SIPAY: { name: 'Sipay', fields: ['merchantKey', 'appKey', 'appSecret'], optionalFields: ['merchantId'] },
  MOCK: { name: 'Test POS', fields: ['merchantId'], optionalFields: [] },
} as const satisfies Record<string, { name: string; fields: readonly string[]; optionalFields: readonly string[] }>;

export type OwnPosProviderCode = keyof typeof OWN_POS_PROVIDERS;
export const OWN_POS_PROVIDER_CODES = Object.keys(OWN_POS_PROVIDERS) as OwnPosProviderCode[];

const CredentialValue = z.string().trim().min(1).max(512);

export const ConnectOwnPosSchema = z
  .object({
    providerCode: z.enum(OWN_POS_PROVIDER_CODES as [OwnPosProviderCode, ...OwnPosProviderCode[]]),
    credentials: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,40}$/), CredentialValue),
  })
  .strict()
  .superRefine((value, ctx) => {
    const spec = OWN_POS_PROVIDERS[value.providerCode];
    const allowed = new Set<string>([...spec.fields, ...spec.optionalFields]);
    for (const field of spec.fields) {
      if (!value.credentials[field])
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['credentials', field], message: 'required' });
    }
    for (const key of Object.keys(value.credentials)) {
      if (!allowed.has(key))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['credentials', key], message: 'unknown field' });
    }
  });
export type ConnectOwnPosInput = z.infer<typeof ConnectOwnPosSchema>;

export const UpdatePaymentModeSchema = z.object({ paymentMode: z.nativeEnum(PaymentMode) }).strict();

/** What the restaurant panel sees: never the credentials. */
/** String form of the mode so Prisma's generated enum and the shared enum stay assignable. */
export type PaymentModeValue = `${PaymentMode}`;

export interface PaymentSettingsDTO {
  paymentMode: PaymentModeValue;
  connection: {
    providerCode: string;
    status: string;
    /** Masked identification of the connection, e.g. the merchant id's last characters. */
    label: string;
    lastVerifiedAt: string | null;
  } | null;
  /** Commission the platform will invoice for the current month so far (OWN_POS). */
  accruedCommissionMinor: number;
  currency: string;
}

// -- Card vault --------------------------------------------------------------------

/** Cross-merchant wallets (Masterpass, bex), the PSP's own tokens, device wallets and the development vault. */
export const CARD_VAULT_PROVIDERS = ['MASTERPASS', 'BEX', 'PSP_TOKEN', 'GOOGLE_PAY', 'APPLE_PAY', 'MOCK'] as const;
export type CardVaultProviderCode = (typeof CARD_VAULT_PROVIDERS)[number];

/** A stored card as the customer sees it: the vault's token is never exposed. */
export interface SavedPaymentMethodDTO {
  id: string;
  provider: CardVaultProviderCode;
  brand: string;
  last4: string;
  expiryMonth: number;
  expiryYear: number;
  label: string | null;
  isDefault: boolean;
}

export const SavedCardMetadataSchema = z
  .object({
    brand: z.string().trim().min(2).max(30),
    last4: z.string().regex(/^\d{4}$/),
    expiryMonth: z.number().int().min(1).max(12),
    expiryYear: z.number().int().min(2024).max(2100),
    label: z.string().trim().max(40).nullable().optional(),
  })
  .strict();
export type SavedCardMetadata = z.infer<typeof SavedCardMetadataSchema>;

export interface VaultChargeRequest {
  /** The vault's token for the customer's card. */
  token: string;
  amountMinor: number;
  currency: string;
  /** Merchant the charge is for: the platform's PSP merchant or the restaurant's own POS connection id. */
  merchantRef: string;
  orderRef: string;
  /** Where the 3-D Secure challenge returns to. */
  returnUrl: string;
}

export interface VaultChargeResult {
  status: 'CAPTURED' | 'REQUIRES_3DS' | 'FAILED';
  providerRef: string | null;
  /** URL of the 3-D Secure challenge when status is REQUIRES_3DS. */
  redirectUrl: string | null;
  failureCode: string | null;
}

/**
 * A card vault keeps the card; the platform keeps the token. Linking happens
 * in the vault's own UI (Masterpass: phone number and OTP; PSP: hosted card
 * form), so no PAN ever reaches the platform.
 */
export interface CardVaultAdapter {
  readonly code: CardVaultProviderCode;
  /** True when a token of this vault can be charged at a merchant other than the one that stored it. */
  readonly crossMerchant: boolean;
  /** Starts the vault's own linking flow; the result's URL or SDK params go to the client. */
  beginLink(
    userRef: string,
    returnUrl: string,
  ): Promise<{ redirectUrl: string | null; clientParams: Record<string, string> }>;
  /** Completes linking from the vault's callback and returns the cards now available. */
  completeLink(
    userRef: string,
    callbackPayload: Record<string, string>,
  ): Promise<Array<SavedCardMetadata & { token: string }>>;
  charge(request: VaultChargeRequest): Promise<VaultChargeResult>;
  forget(token: string): Promise<void>;
}

// -- Payment gateways (where the money goes) ----------------------------------

export interface HostedCheckoutSession {
  providerCode: string;
  sessionId: string;
  /** Hosted payment page or iframe URL; card data is typed there, never on the platform. */
  redirectUrl: string;
  expiresAt: string;
}

export interface GatewayWebhookEvent {
  providerRef: string;
  orderRef: string;
  /** CHARGEBACK: the cardholder's bank took the money back (docs/MUTABAKAT.md, "İade ve chargeback"). */
  status: 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'CHARGEBACK';
  amountMinor: number;
  currency: string;
  /** The PSP's own fee when the webhook carries it. */
  pspFeeMinor: number | null;
  occurredAt: string;
  /** The exact answer the provider expects (PayTR wants a plain "OK"); JSON when absent. */
  ack?: { contentType: string; body: string };
  /** Set when the notification was the customer's browser (a provider callback): where to send it next. */
  browserRedirectUrl?: string;
}

/** What a hosted checkout needs from the order; optional fields are passed when known, providers fill the rest. */
export interface HostedCheckoutParams {
  orderRef: string;
  amountMinor: number;
  currency: string;
  /** Where the customer's browser goes after the provider's page. */
  returnUrl: string;
  customerPhone: string;
  customerName?: string;
  customerIp?: string;
  /** The platform's webhook endpoint for this connection; providers that take it per request post there. */
  notifyUrl?: string;
}

/** One provider behind which either a restaurant's own POS or the platform's PSP merchant lives. */
export interface PaymentGatewayAdapter {
  readonly code: string;
  /** Cheap credential check at connection time (a zero-amount or a provider "ping"). */
  verifyCredentials(credentials: Record<string, string>): Promise<{ ok: boolean; label: string; reason?: string }>;
  createHostedCheckout(
    credentials: Record<string, string>,
    params: HostedCheckoutParams,
  ): Promise<HostedCheckoutSession>;
  refund(
    credentials: Record<string, string>,
    providerRef: string,
    amountMinor: number,
  ): Promise<{ ok: boolean; providerRef: string | null }>;
  /**
   * Verifies and interprets a provider notification. Some providers only
   * announce that something happened and the truth is fetched from them, so
   * the result may be a promise. `query` carries the request's query string
   * (a browser callback may bring the return address there).
   */
  parseWebhook(
    credentials: Record<string, string>,
    rawBody: string,
    headers: Record<string, string | undefined>,
    query?: Record<string, string | undefined>,
  ): GatewayWebhookEvent | Promise<GatewayWebhookEvent>;
}

// -- Commission by payment mode -------------------------------------------------

export interface ModeSettlement extends Settlement {
  paymentMode: PaymentModeValue;
  /** OWN_POS: what the restaurant owes the platform for this order (commission + VAT). PLATFORM_PSP: 0, it is deducted from the payout. */
  platformReceivableMinor: number;
  /** PLATFORM_PSP: what the platform pays out. OWN_POS: 0, the restaurant already has the money. */
  payoutMinor: number;
}

/**
 * Runs the settlement engine for a payment mode. In OWN_POS the platform
 * neither charges a PSP fee nor withholds tax (it never touches the money),
 * so those inputs are forced to zero; the restaurant's own PSP cost is a
 * matter between the restaurant and its bank.
 */
export function computeModeSettlement(mode: PaymentModeValue, input: SettlementInput): ModeSettlement {
  const effective: SettlementInput =
    mode === PaymentMode.OWN_POS
      ? { ...input, psp: { percentBps: 0, fixedMinor: 0, bearer: 'RESTAURANT' }, withholdingBps: 0 }
      : input;
  const settlement = computeOrderSettlement(effective);
  const owed = settlement.platformCommissionMinor + settlement.commissionVatMinor;
  if (mode === PaymentMode.OWN_POS) {
    // The restaurant keeps everything the customer paid; the statement shows what it owes.
    const ledger = settlement.ledger.filter((l) => l.type !== LedgerEntryType.RESTAURANT_PAYABLE);
    ledger.push({ type: LedgerEntryType.RESTAURANT_PAYABLE, amountMinor: settlement.restaurantPayableMinor });
    return { ...settlement, ledger, paymentMode: mode, platformReceivableMinor: owed, payoutMinor: 0 };
  }
  return {
    ...settlement,
    paymentMode: mode,
    platformReceivableMinor: 0,
    payoutMinor: settlement.restaurantPayableMinor,
  };
}

// -- Monthly commission invoice (OWN_POS) -------------------------------------------

export interface CommissionLine {
  orderId: string;
  /** Set on a credit line: the refund whose commission share it gives back (docs/MUTABAKAT.md, "Kısmi iade"). */
  refundId?: string;
  /** Commission base of the order (items after a restaurant-funded discount). */
  baseMinor: number;
  commissionMinor: number;
  commissionVatMinor: number;
}

export interface CommissionStatement {
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  orderCount: number;
  baseMinor: number;
  commissionMinor: number;
  vatMinor: number;
  totalMinor: number;
  lines: CommissionLine[];
  /**
   * Commission given back by refunds and chargebacks after completion, one
   * line per refund with its share (docs/MUTABAKAT.md, "Kısmi iade"):
   * credited here, so commissionMinor, vatMinor and totalMinor are net of
   * them.
   */
  credits: CommissionLine[];
  creditCommissionMinor: number;
  creditVatMinor: number;
}

export const CommissionPeriodSchema = z
  .object({ year: z.number().int().min(2024).max(2100), month: z.number().int().min(1).max(12) })
  .strict();

/** UTC month boundaries; invoices are cut in UTC so every tenant's month is the same calendar month. */
export function commissionPeriod(year: number, month: number): { periodStart: Date; periodEnd: Date } {
  return { periodStart: new Date(Date.UTC(year, month - 1, 1)), periodEnd: new Date(Date.UTC(year, month, 1)) };
}

/**
 * Sums the per-order lines of a month into one invoice. Commission and VAT
 * are the amounts snapshotted on each order, never recomputed, so a later
 * rate change cannot touch an already served month.
 */
export function buildCommissionStatement(
  currency: string,
  period: { periodStart: Date; periodEnd: Date },
  lines: readonly CommissionLine[],
  credits: readonly CommissionLine[] = [],
): CommissionStatement {
  const sum = (from: readonly CommissionLine[], pick: (l: CommissionLine) => number) =>
    from.reduce((n, l) => n + pick(l), 0);
  const creditCommissionMinor = sum(credits, (l) => l.commissionMinor);
  const creditVatMinor = sum(credits, (l) => l.commissionVatMinor);
  const commissionMinor = sum(lines, (l) => l.commissionMinor) - creditCommissionMinor;
  const vatMinor = sum(lines, (l) => l.commissionVatMinor) - creditVatMinor;
  return {
    currency,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    orderCount: lines.length,
    baseMinor: sum(lines, (l) => l.baseMinor),
    commissionMinor,
    vatMinor,
    totalMinor: commissionMinor + vatMinor,
    lines: [...lines],
    credits: [...credits],
    creditCommissionMinor,
    creditVatMinor,
  };
}

/**
 * Which pending commission credits an invoice absorbs: whole refund lines, oldest
 * first, while their total stays below the month's charges, so an invoice
 * is never zero or negative; the rest waits for the next invoice.
 */
export function applyCommissionCredits(
  charges: readonly CommissionLine[],
  pending: readonly CommissionLine[],
): { applied: CommissionLine[]; carried: CommissionLine[] } {
  const charged = charges.reduce((n, l) => n + l.commissionMinor + l.commissionVatMinor, 0);
  const applied: CommissionLine[] = [];
  const carried: CommissionLine[] = [];
  let credited = 0;
  for (const credit of pending) {
    const amount = credit.commissionMinor + credit.commissionVatMinor;
    if (credited + amount < charged) {
      applied.push(credit);
      credited += amount;
    } else {
      carried.push(credit);
    }
  }
  return { applied, carried };
}

/** Ledger lines that give a PLATFORM_PSP restaurant its commission back on a refunded or charged-back order. */
export function commissionReversalLines(order: {
  platformCommissionMinor: number;
  commissionVatMinor: number;
}): { type: 'COMMISSION_REVERSAL' | 'COMMISSION_VAT_REVERSAL'; amountMinor: number }[] {
  const lines: { type: 'COMMISSION_REVERSAL' | 'COMMISSION_VAT_REVERSAL'; amountMinor: number }[] = [];
  if (order.platformCommissionMinor > 0)
    lines.push({ type: 'COMMISSION_REVERSAL', amountMinor: order.platformCommissionMinor });
  if (order.commissionVatMinor > 0)
    lines.push({ type: 'COMMISSION_VAT_REVERSAL', amountMinor: order.commissionVatMinor });
  return lines;
}

/** Days after issue before an unpaid commission invoice counts as overdue and the marketplace listing is paused. */
export const COMMISSION_INVOICE_DUE_DAYS = 10;

export function commissionDueAt(issuedAt: Date, dueDays: number = COMMISSION_INVOICE_DUE_DAYS): Date {
  return new Date(issuedAt.getTime() + dueDays * 86400000);
}

/** Convenience for screens: commission and VAT of a basket under a restaurant's contract, without the full engine. */
export function quickCommission(
  baseMinor: number,
  commissionBps: number,
  commissionVatBps: number,
): { commissionMinor: number; vatMinor: number } {
  BasisPointsSchema.parse(commissionBps);
  BasisPointsSchema.parse(commissionVatBps);
  const commissionMinor = bpsOf(baseMinor, commissionBps);
  return { commissionMinor, vatMinor: bpsOf(commissionMinor, commissionVatBps) };
}
