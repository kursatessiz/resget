import { z } from 'zod';
import { minorDigitsOf } from './money';

/**
 * Bulk menu import (docs/PANEL.md, "Menü içe aktarma"): a restaurant brings
 * its existing menu as a spreadsheet saved as CSV instead of typing it item
 * by item. The file is checked line by line first (dry run) and applied only
 * when every line is valid; existing items are matched by category and item
 * name, so the same file can be imported again to update prices.
 */

export const MENU_IMPORT_MAX_ROWS = 2000;
export const MENU_IMPORT_MAX_CHARS = 512 * 1024;

/** Canonical column names; the header may also use the aliases (Turkish spreadsheet headings, spaces, accents). */
export const MENU_IMPORT_COLUMNS = ['category', 'name', 'description', 'price', 'vat_rate', 'available'] as const;
export type MenuImportColumn = (typeof MENU_IMPORT_COLUMNS)[number];
const REQUIRED_COLUMNS: readonly MenuImportColumn[] = ['category', 'name', 'price'];

const COLUMN_ALIASES: Record<MenuImportColumn, readonly string[]> = {
  category: ['category', 'kategori', 'grup'],
  name: ['name', 'item', 'ad', 'adi', 'urun', 'urun adi', 'urun_adi'],
  description: ['description', 'aciklama', 'icerik'],
  price: ['price', 'fiyat', 'tutar'],
  vat_rate: ['vat_rate', 'vat', 'kdv', 'kdv orani', 'kdv_orani'],
  available: ['available', 'satista', 'aktif', 'durum'],
};

/** VAT on restaurant food by country when the file has no VAT column; null means the column is required. */
export const FOOD_VAT_BPS_BY_COUNTRY: Readonly<Record<string, number>> = { TR: 1000 };

export function foodVatBpsFor(countryCode: string): number | null {
  return FOOD_VAT_BPS_BY_COUNTRY[countryCode.toUpperCase()] ?? null;
}

export type MenuImportIssueCode =
  | 'EMPTY_FILE'
  | 'TOO_MANY_ROWS'
  | 'MISSING_COLUMN'
  | 'CATEGORY_REQUIRED'
  | 'NAME_REQUIRED'
  | 'TOO_LONG'
  | 'PRICE_INVALID'
  | 'VAT_INVALID'
  | 'VAT_REQUIRED'
  | 'AVAILABLE_INVALID'
  | 'DUPLICATE_ITEM';

export interface MenuImportIssue {
  /** 1-based line of the file; 1 is the header. */
  line: number;
  code: MenuImportIssueCode;
  column?: MenuImportColumn;
}

export interface MenuImportRow {
  line: number;
  category: string;
  name: string;
  /** undefined when the file has no description column: an update leaves the stored text alone. */
  description: string | null | undefined;
  priceMinor: number;
  /** undefined when the file has no VAT column and the item exists: its rate stays. */
  vatRateBps: number | undefined;
  isAvailable: boolean | undefined;
}

export interface ParsedMenuImport {
  rows: MenuImportRow[];
  issues: MenuImportIssue[];
  /** VAT applied to new items when the file has no VAT column. */
  defaultVatRateBps: number | null;
}

export const ImportMenuSchema = z
  .object({
    csv: z.string().min(1).max(MENU_IMPORT_MAX_CHARS),
    dryRun: z.boolean().default(true),
  })
  .strict();
export type ImportMenuInput = z.infer<typeof ImportMenuSchema>;

export interface MenuImportResultDTO {
  dryRun: boolean;
  applied: boolean;
  rows: number;
  categoriesCreated: string[];
  itemsCreated: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  issues: MenuImportIssue[];
}

/** Key a category or item is matched on: case, accents of a capital I and repeated spaces do not make a different name. */
export function menuMatchKey(value: string): string {
  return value.normalize('NFKC').replace(/İ/g, 'i').toLowerCase().replace(/\s+/g, ' ').trim();
}

function headerKey(value: string): string {
  return menuMatchKey(value)
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 _]/g, '')
    .trim();
}

/**
 * RFC 4180 style CSV: quoted fields with doubled quotes, CRLF or LF, and the
 * delimiter a spreadsheet chose (comma, semicolon as Excel uses in locales
 * with a decimal comma, or tab), guessed from the header line.
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', '\t', ','].reduce(
    (best, candidate) => (firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best),
    ',',
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field.length === 0) quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Price text in major units into minor units: "120", "120,50", "1.250,50", "1,250.50"; null when it is not a plain amount. */
export function parseImportPrice(text: string, currency: string): number | null {
  let value = text
    .trim()
    .replace(/\s/g, '')
    .replace(/[^\d.,-]/g, '');
  if (!value || value.startsWith('-')) return null;
  const lastDot = value.lastIndexOf('.');
  const lastComma = value.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both appear: the later one is the decimal mark, the other groups thousands.
    const decimal = lastDot > lastComma ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    value = value.split(group).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    value = value.replace(',', '.');
  }
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const digits = minorDigitsOf(currency);
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > digits) return null;
  return Number(whole) * 10 ** digits + Number((fraction + '0'.repeat(digits)).slice(0, digits) || '0');
}

/** VAT as a percentage ("10", "%10", "10,5") into basis points; null when it is not a rate between 0 and 100. */
export function parseImportVat(text: string): number | null {
  // One percent sign before or after the number; anything else fails the pattern below.
  let value = text.trim();
  if (value.startsWith('%')) value = value.slice(1).trimStart();
  else if (value.endsWith('%')) value = value.slice(0, -1).trimEnd();
  value = value.split(',').join('.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const bps = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return bps <= 10000 ? bps : null;
}

const TRUE_WORDS = new Set(['1', 'true', 'yes', 'evet', 'var', 'aktif', 'satista', 'x']);
const FALSE_WORDS = new Set(['0', 'false', 'no', 'hayir', 'yok', 'pasif', 'tukendi']);

export function parseImportAvailable(text: string): boolean | null {
  const key = headerKey(text);
  if (key === '') return true;
  if (TRUE_WORDS.has(key)) return true;
  if (FALSE_WORDS.has(key)) return false;
  return null;
}

/** Checks a whole file and returns the rows ready to apply, or every problem with its line. */
export function parseMenuCsv(text: string, currency: string, countryCode: string): ParsedMenuImport {
  const defaultVatRateBps = foodVatBpsFor(countryCode);
  const table = parseCsv(text).filter((cells) => cells.some((c) => c.trim() !== ''));
  const issues: MenuImportIssue[] = [];
  if (table.length < 2) return { rows: [], issues: [{ line: 1, code: 'EMPTY_FILE' }], defaultVatRateBps };
  if (table.length - 1 > MENU_IMPORT_MAX_ROWS) {
    return { rows: [], issues: [{ line: MENU_IMPORT_MAX_ROWS + 2, code: 'TOO_MANY_ROWS' }], defaultVatRateBps };
  }

  const index = new Map<MenuImportColumn, number>();
  table[0].forEach((heading, i) => {
    const key = headerKey(heading);
    const column = MENU_IMPORT_COLUMNS.find((c) => COLUMN_ALIASES[c].includes(key));
    if (column && !index.has(column)) index.set(column, i);
  });
  for (const column of REQUIRED_COLUMNS) {
    if (!index.has(column)) issues.push({ line: 1, code: 'MISSING_COLUMN', column });
  }
  if (!index.has('vat_rate') && defaultVatRateBps === null) {
    issues.push({ line: 1, code: 'MISSING_COLUMN', column: 'vat_rate' });
  }
  if (issues.length > 0) return { rows: [], issues, defaultVatRateBps };

  const cell = (cells: string[], column: MenuImportColumn): string | undefined => {
    const i = index.get(column);
    return i === undefined ? undefined : (cells[i] ?? '').trim();
  };
  const seen = new Map<string, number>();
  const rows: MenuImportRow[] = [];
  table.slice(1).forEach((cells, offset) => {
    const line = offset + 2;
    const before = issues.length;
    const category = cell(cells, 'category') ?? '';
    const name = cell(cells, 'name') ?? '';
    const description = cell(cells, 'description');
    const priceText = cell(cells, 'price') ?? '';
    const vatText = cell(cells, 'vat_rate');
    const availableText = cell(cells, 'available');

    if (!category) issues.push({ line, code: 'CATEGORY_REQUIRED', column: 'category' });
    else if (category.length > 80) issues.push({ line, code: 'TOO_LONG', column: 'category' });
    if (!name) issues.push({ line, code: 'NAME_REQUIRED', column: 'name' });
    else if (name.length > 80) issues.push({ line, code: 'TOO_LONG', column: 'name' });
    if (description !== undefined && description.length > 500) {
      issues.push({ line, code: 'TOO_LONG', column: 'description' });
    }
    const priceMinor = parseImportPrice(priceText, currency);
    if (priceMinor === null) issues.push({ line, code: 'PRICE_INVALID', column: 'price' });
    let vatRateBps: number | undefined;
    if (vatText !== undefined && vatText !== '') {
      const parsed = parseImportVat(vatText);
      if (parsed === null) issues.push({ line, code: 'VAT_INVALID', column: 'vat_rate' });
      else vatRateBps = parsed;
    } else if (vatText === '' && defaultVatRateBps === null) {
      issues.push({ line, code: 'VAT_REQUIRED', column: 'vat_rate' });
    }
    let isAvailable: boolean | undefined;
    if (availableText !== undefined) {
      const parsed = parseImportAvailable(availableText);
      if (parsed === null) issues.push({ line, code: 'AVAILABLE_INVALID', column: 'available' });
      else isAvailable = parsed;
    }
    if (category && name) {
      const key = `${menuMatchKey(category)}\u0000${menuMatchKey(name)}`;
      if (seen.has(key)) issues.push({ line, code: 'DUPLICATE_ITEM', column: 'name' });
      else seen.set(key, line);
    }
    if (issues.length === before && priceMinor !== null) {
      rows.push({
        line,
        category,
        name,
        description: description === undefined ? undefined : description || null,
        priceMinor,
        vatRateBps,
        isAvailable,
      });
    }
  });
  return { rows, issues, defaultVatRateBps };
}

/** The header and two example lines offered as a template; machine column names, so it works in every language. */
export function menuImportTemplate(): string {
  return [
    MENU_IMPORT_COLUMNS.join(','),
    'Ana yemekler,Izgara kofte,"Pilav ve salata ile",320.00,10,1',
    'Icecekler,Ayran,,45.00,10,1',
  ].join('\n');
}
