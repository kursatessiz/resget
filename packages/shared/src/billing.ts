import { z } from 'zod';
import { CommissionInvoiceStatus } from './enums';
import type { SavedPaymentMethodDTO } from './payments';
import { PaginationSchema, UuidSchema } from './validators';

/**
 * Commission billing (docs/FATURALAMA.md). An OWN_POS restaurant collects its
 * own sales; the platform's 1 percent plus VAT accrues on each completed order
 * (snapshotted at placement) and is cut into one invoice per UTC calendar
 * month. The invoice is collected from the card the restaurant designated,
 * through the same card vault as every other charge; when it stays unpaid
 * past its due date the marketplace listing pauses until it is settled. The
 * panel, the table QR and the restaurant's own page keep working: suspension
 * costs the restaurant visibility, never its ability to serve.
 */

export type CommissionInvoiceStatusValue = `${CommissionInvoiceStatus}`;

export interface CommissionInvoiceDTO {
  id: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  orderCount: number;
  baseMinor: number;
  commissionMinor: number;
  vatMinor: number;
  totalMinor: number;
  status: CommissionInvoiceStatusValue;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  /** Reference of the collection: the vault's charge reference or the bank transfer note. */
  paymentRef: string | null;
  /** The fiscal document (e-Arsiv or the regional equivalent) issued for this invoice. */
  fiscalRef: string | null;
  fiscalDocumentUrl: string | null;
  collectionAttempts: number;
  lastCollectionAt: string | null;
  lastCollectionError: string | null;
}

export interface BillingOverviewDTO {
  currency: string;
  invoices: CommissionInvoiceDTO[];
  /** The card charged automatically when an invoice is issued; null until the restaurant picks one. */
  billingCard: SavedPaymentMethodDTO | null;
  listingSuspendedAt: string | null;
  /** Sum of ISSUED and OVERDUE invoices. */
  openTotalMinor: number;
  dueDays: number;
}

export const SetBillingCardSchema = z.object({ paymentMethodId: UuidSchema.nullable() }).strict();
export type SetBillingCardInput = z.infer<typeof SetBillingCardSchema>;

export const PayInvoiceSchema = z
  .object({
    /** A card of the caller; omitted means the restaurant's billing card. */
    paymentMethodId: UuidSchema.optional(),
    returnUrl: z.string().url(),
  })
  .strict();
export type PayInvoiceInput = z.infer<typeof PayInvoiceSchema>;

export interface PayInvoiceResultDTO {
  status: 'CAPTURED' | 'REQUIRES_3DS' | 'FAILED';
  redirectUrl: string | null;
  failureCode: string | null;
  invoice: CommissionInvoiceDTO;
}

// -- Platform side ---------------------------------------------------------------------

export const BillingRunSchema = z
  .object({
    /** Pretend it is this moment: cuts the month before it and ages the invoices to it. Default now. */
    asOf: z.string().datetime().optional(),
  })
  .strict();
export type BillingRunInput = z.infer<typeof BillingRunSchema>;

export interface BillingRunReportDTO {
  asOf: string;
  periodStart: string;
  periodEnd: string;
  /** Invoices created for the period. */
  issued: number;
  /** Restaurants with no commission in the period (no invoice is written for zero). */
  skipped: number;
  /** Fiscal documents issued or retried. */
  fiscalized: number;
  collected: number;
  collectionFailed: number;
  overdue: number;
  suspended: number;
}

export const AdminInvoiceQuerySchema = PaginationSchema.extend({
  status: z.nativeEnum(CommissionInvoiceStatus).optional(),
  restaurantId: UuidSchema.optional(),
}).strict();
export type AdminInvoiceQuery = z.infer<typeof AdminInvoiceQuerySchema>;

export interface AdminInvoiceDTO extends CommissionInvoiceDTO {
  restaurant: { id: string; name: string; slug: string };
}

export interface AdminInvoicePageDTO {
  items: AdminInvoiceDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export const MarkInvoicePaidSchema = z.object({ paymentRef: z.string().trim().min(2).max(120) }).strict();
export type MarkInvoicePaidInput = z.infer<typeof MarkInvoicePaidSchema>;

// -- Rules -------------------------------------------------------------------------------

/** How many automatic charges an invoice gets before a person has to look at it. */
export const MAX_COLLECTION_ATTEMPTS = 5;
/** The daily job retries a failed charge no sooner than this. */
export const COLLECTION_RETRY_HOURS = 20;

/** The UTC calendar month before the given moment: what the daily job invoices. */
export function previousCommissionPeriod(now: Date): { year: number; month: number } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based current month = 1-based previous month
  return month === 0 ? { year: year - 1, month: 12 } : { year, month };
}

export function invoiceIsOverdue(
  invoice: { status: CommissionInvoiceStatusValue; dueAt: Date | string | null },
  now: Date,
): boolean {
  if (invoice.status !== 'ISSUED' || !invoice.dueAt) return false;
  return new Date(invoice.dueAt).getTime() < now.getTime();
}

/** An open invoice gets another automatic charge when it has attempts left and the last one is old enough. */
export function collectionIsDue(
  invoice: {
    status: CommissionInvoiceStatusValue;
    collectionAttempts: number;
    lastCollectionAt: Date | string | null;
  },
  now: Date,
): boolean {
  if (invoice.status !== 'ISSUED' && invoice.status !== 'OVERDUE') return false;
  if (invoice.collectionAttempts >= MAX_COLLECTION_ATTEMPTS) return false;
  if (!invoice.lastCollectionAt) return true;
  return now.getTime() - new Date(invoice.lastCollectionAt).getTime() >= COLLECTION_RETRY_HOURS * 3_600_000;
}

/** Open means the restaurant still owes it. */
export function invoiceIsOpen(status: CommissionInvoiceStatusValue): boolean {
  return status === 'ISSUED' || status === 'OVERDUE';
}

// -- Fiscal documents ----------------------------------------------------------------------

export interface FiscalInvoiceInput {
  invoiceId: string;
  restaurant: { name: string; legalName: string | null; taxId: string | null; countryCode: string };
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  orderCount: number;
  baseMinor: number;
  commissionMinor: number;
  vatMinor: number;
  totalMinor: number;
}

export interface FiscalInvoiceResult {
  /** The document number or UUID the authority knows the invoice by. */
  ref: string;
  documentUrl: string | null;
}

/**
 * Where the legal invoice is produced: e-Arsiv through an integrator in
 * Turkey, the regional equivalent elsewhere. The platform's own invoicing
 * data (amounts, period, parties) is the input; the adapter never computes
 * money. A real integrator is a new adapter behind this interface, chosen by
 * INVOICE_PROVIDER, not a code path in the billing job.
 */
export interface InvoiceProviderAdapter {
  readonly code: string;
  issue(input: FiscalInvoiceInput): Promise<FiscalInvoiceResult>;
  cancel(ref: string): Promise<void>;
}
