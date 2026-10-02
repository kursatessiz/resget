import { z } from 'zod';

/**
 * Money is always an integer amount in the currency's minor unit (kurus,
 * cent) together with its ISO 4217 code. No float arithmetic anywhere; the
 * only rounding happens in bpsOf(), once per computed line.
 */
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 currency code expected');
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

export const MinorAmountSchema = z.number().int().min(0);
/** Basis points: 100 = 1 percent, 10000 = 100 percent. */
export const BasisPointsSchema = z.number().int().min(0).max(10000);

export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

export const MoneySchema = z.object({ amountMinor: MinorAmountSchema, currency: CurrencyCodeSchema }).strict();

export function money(amountMinor: number, currency: CurrencyCode): Money {
  assertMinor(amountMinor);
  return { amountMinor, currency };
}

export function assertMinor(value: number): void {
  if (!Number.isInteger(value)) throw new RangeError(`minor unit amount must be an integer, got ${value}`);
}

/** `amount * bps / 10000`, rounded half up. Both inputs are integers. */
export function bpsOf(amountMinor: number, bps: number): number {
  assertMinor(amountMinor);
  if (!Number.isInteger(bps) || bps < 0)
    throw new RangeError(`basis points must be a non-negative integer, got ${bps}`);
  return Math.round((amountMinor * bps) / 10000);
}

/** The VAT-exclusive part of a gross amount that includes VAT at `vatRateBps`. */
export function netOfVat(grossMinor: number, vatRateBps: number): number {
  assertMinor(grossMinor);
  return Math.round((grossMinor * 10000) / (10000 + vatRateBps));
}

/** Formats with the viewer's locale; the currency decides the minor digits. Never hardcode 'tr-TR'. */
export function formatMoney(value: Money, locale: string): string {
  const digits = minorDigitsOf(value.currency);
  const major = value.amountMinor / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: value.currency }).format(major);
  } catch {
    return `${major.toFixed(digits)} ${value.currency}`;
  }
}

/** Minor unit digits of a currency, read from Intl so the table never has to be maintained by hand. */
export function minorDigitsOf(currency: CurrencyCode): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}
