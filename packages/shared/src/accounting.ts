import { z } from 'zod';
import { majorAmountText } from './money';

/**
 * Accounting export (docs/MUHASEBE_AKTARIMI.md, module accounting_export):
 * a month of orders and their lines as CSV for the restaurant's accountant.
 * Every amount is the snapshot the order already carries (the settlement at
 * placement, the refunds as recorded); nothing is recomputed here, so the
 * file always matches the panel, the ledger and the commission invoice.
 * The month is the UTC calendar month, the same as the commission invoice.
 */

export const AccountingPeriodSchema = z
  .object({
    year: z.coerce.number().int().min(2024).max(2100),
    month: z.coerce.number().int().min(1).max(12),
  })
  .strict();
export type AccountingPeriod = z.infer<typeof AccountingPeriodSchema>;

export const ACCOUNTING_ORDER_COLUMNS = [
  'order',
  'orderId',
  'placedAtUtc',
  'placedAtLocal',
  'completedAtLocal',
  'status',
  'channel',
  'fulfillment',
  'paymentMethod',
  'paymentProvider',
  'paymentMode',
  'currency',
  'itemsGross',
  'itemsVat',
  'itemsNet',
  'deliveryFee',
  'discount',
  'discountFundedBy',
  'chargedToCustomer',
  'refunded',
  'commissionRatePercent',
  'commission',
  'commissionVat',
  'pspFee',
  'pspFeeBearer',
  'withholding',
  'courierCost',
  'courierBearer',
  'restaurantPayable',
  'platformReceivable',
] as const;

export const ACCOUNTING_LINE_COLUMNS = [
  'order',
  'placedAtLocal',
  'status',
  'item',
  'options',
  'quantity',
  'unitPrice',
  'vatRatePercent',
  'lineTotal',
  'currency',
] as const;

/** A value in a cell: generated amounts and dates, or tenant text that is neutralised. */
export type AccountingCell = string | number | null;

/** An amount as plain decimal text in major units ("1234.50"), the way spreadsheets read it. */
export function accountingAmount(amountMinor: number, currency: string): string {
  return majorAmountText(amountMinor, currency);
}

/** Basis points as a percent with two decimals ("10.00"). */
export function bpsPercentText(bps: number): string {
  const sign = bps < 0 ? '-' : '';
  const abs = Math.abs(bps);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Wall-clock date and time of an instant in a time zone, "YYYY-MM-DD HH:mm", independent of any locale. */
export function localDateTimeText(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * One CSV cell. Numbers and our own numeric text stay as they are (a refund
 * or a negative amount must not gain a quote); any other text starting with
 * a formula character is neutralised, and a cell with a comma, quote or line
 * break is quoted.
 */
export function accountingCell(value: AccountingCell): string {
  if (value === null) return '';
  let text = String(value);
  if (!NUMERIC.test(text) && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Header plus rows, CRLF line ends, with a byte order mark so spreadsheet programs read UTF-8. */
export function accountingCsv(header: readonly string[], rows: readonly AccountingCell[][]): string {
  return '﻿' + [header.join(','), ...rows.map((row) => row.map(accountingCell).join(','))].join('\r\n') + '\r\n';
}

/** The download name of a month's file, e.g. "resget-orders-2026-10.csv". */
export function accountingFileName(kind: 'orders' | 'lines', period: AccountingPeriod): string {
  return `resget-${kind}-${period.year}-${String(period.month).padStart(2, '0')}.csv`;
}
