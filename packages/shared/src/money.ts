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

/**
 * `amount * part / whole`, rounded half up: the share of an amount that a
 * part of a whole carries (a partial refund's share of the commission,
 * docs/MUTABAKAT.md "Kısmi iade"). The part is capped at the whole, so the
 * share never exceeds the amount; a zero whole carries nothing.
 */
export function shareOf(amountMinor: number, partMinor: number, wholeMinor: number): number {
  assertMinor(amountMinor);
  assertMinor(partMinor);
  assertMinor(wholeMinor);
  if (wholeMinor <= 0 || partMinor <= 0) return 0;
  if (partMinor >= wholeMinor) return amountMinor;
  return Math.round((amountMinor * partMinor) / wholeMinor);
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

/**
 * Parses an amount a person typed in major units ("42", "42.5", "42,50")
 * into minor units for the currency. Extra fraction digits are cut, never
 * rounded; null when the text is not a plain number.
 */
export function parseMajorAmount(text: string, currency: CurrencyCode): number | null {
  const normalized = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const digits = minorDigitsOf(currency);
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = (negative ? normalized.slice(1) : normalized).split('.');
  const minor = Number(whole) * 10 ** digits + Number((fraction + '0'.repeat(digits)).slice(0, digits));
  return negative ? -minor : minor;
}

/** Minor units as the text of an input field in major units ("42.50"), independent of the viewer's locale. */
export function majorAmountText(amountMinor: number, currency: CurrencyCode): string {
  const digits = minorDigitsOf(currency);
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(amountMinor);
  const whole = Math.floor(abs / 10 ** digits);
  if (digits === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(abs % 10 ** digits).padStart(digits, '0')}`;
}
