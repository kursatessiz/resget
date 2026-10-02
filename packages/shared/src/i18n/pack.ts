import { hasOwn } from './own';
import { z } from 'zod';
import { BASE_LOCALE, LocaleCodeSchema } from './locales';
import { placeholdersOf } from './translator';

/**
 * Language pack files: what the super admin downloads, hands to a
 * translator, and uploads back. Two formats carry the same content:
 *
 * - JSON (`platform.language-pack`, formatVersion 1): exact round trip.
 * - CSV (UTF-8 with BOM so Excel keeps Turkish characters): columns
 *   key, source (Turkish), translation. Only `key` and `translation` are
 *   read back; `source` is context for the translator.
 *
 * Upload rules (validatePackMessages):
 * - unknown keys are ignored and reported (a key removed from the code);
 * - empty values mean "not translated" and are skipped;
 * - a value whose `{placeholders}` differ from the Turkish source is
 *   rejected, and the whole upload is refused while any remain, because a
 *   lost `{name}` would render a broken sentence to users.
 */

export const LANGUAGE_PACK_FORMAT = 'platform.language-pack' as const;
export const LANGUAGE_PACK_FORMAT_VERSION = 1 as const;
export const LANGUAGE_PACK_MAX_BYTES = 2 * 1024 * 1024;
export const TRANSLATION_MAX_LENGTH = 2000;

/** Dotted segments starting with a letter; rules out __proto__ and friends. */
export const MessageKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*(\.[a-zA-Z0-9_-]+)*$/);

export const LanguagePackSchema = z
  .object({
    format: z.literal(LANGUAGE_PACK_FORMAT),
    formatVersion: z.literal(LANGUAGE_PACK_FORMAT_VERSION),
    locale: LocaleCodeSchema,
    name: z.string().max(60).optional(),
    nativeName: z.string().max(60).optional(),
    baseLocale: z.literal(BASE_LOCALE),
    exportedAt: z.string().optional(),
    messages: z.record(MessageKeySchema, z.string().max(TRANSLATION_MAX_LENGTH)),
  })
  .strict();
export type LanguagePack = z.infer<typeof LanguagePackSchema>;

export const LanguagePackFileFormatSchema = z.enum(['json', 'csv']);
export type LanguagePackFileFormat = z.infer<typeof LanguagePackFileFormatSchema>;

/** POST /admin/i18n/languages/:code/import body. */
export const ImportLanguagePackSchema = z
  .object({
    format: LanguagePackFileFormatSchema,
    content: z.string().min(1).max(LANGUAGE_PACK_MAX_BYTES),
    /** Validate and report without writing anything. */
    dryRun: z.boolean().default(false),
    /**
     * "merge" keeps existing overrides for keys the file leaves empty;
     * "replace" removes every override not present in the file.
     */
    mode: z.enum(['merge', 'replace']).default('merge'),
  })
  .strict();
export type ImportLanguagePackInput = z.infer<typeof ImportLanguagePackSchema>;

export interface PlaceholderMismatch {
  key: string;
  expected: string[];
  actual: string[];
}

export interface PackValidationResult {
  /** Keys with a valid, non-empty value. */
  accepted: Record<string, string>;
  unknownKeys: string[];
  emptyKeys: string[];
  placeholderMismatches: PlaceholderMismatch[];
}

export interface ImportReportDTO {
  locale: string;
  dryRun: boolean;
  /** False when placeholder mismatches blocked the upload; nothing was written. */
  applied: boolean;
  acceptedCount: number;
  changedCount: number;
  removedCount: number;
  unknownKeys: string[];
  emptyKeys: string[];
  placeholderMismatches: PlaceholderMismatch[];
}

export function validatePackMessages(
  messages: Record<string, string>,
  base: Readonly<Record<string, string>>,
): PackValidationResult {
  const accepted: Record<string, string> = {};
  const unknownKeys: string[] = [];
  const emptyKeys: string[] = [];
  const placeholderMismatches: PlaceholderMismatch[] = [];

  for (const [key, raw] of Object.entries(messages)) {
    const source = hasOwn(base, key) ? base[key] : undefined;
    if (source === undefined) {
      unknownKeys.push(key);
      continue;
    }
    const value = raw.trim() === '' ? '' : raw;
    if (value === '') {
      emptyKeys.push(key);
      continue;
    }
    const expected = placeholdersOf(source);
    const actual = placeholdersOf(value);
    if (expected.join(',') !== actual.join(',')) {
      placeholderMismatches.push({ key, expected, actual });
      continue;
    }
    accepted[key] = value;
  }
  return {
    accepted,
    unknownKeys: unknownKeys.sort(),
    emptyKeys: emptyKeys.sort(),
    placeholderMismatches: placeholderMismatches.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** Share of base keys that have a non-empty value in `messages`. */
export function packCompletion(
  messages: Readonly<Record<string, string>>,
  base: Readonly<Record<string, string>>,
): { translatedKeys: number; totalKeys: number; completion: number } {
  const keys = Object.keys(base);
  const translatedKeys = keys.filter((key) => hasOwn(messages, key) && messages[key].trim() !== '').length;
  const totalKeys = keys.length;
  return { translatedKeys, totalKeys, completion: totalKeys === 0 ? 1 : translatedKeys / totalKeys };
}

export function buildLanguagePack(input: {
  locale: string;
  name?: string;
  nativeName?: string;
  messages: Readonly<Record<string, string>>;
  base: Readonly<Record<string, string>>;
  exportedAt?: Date;
}): LanguagePack {
  const messages: Record<string, string> = {};
  // Every base key is present so translators see what is missing.
  for (const key of Object.keys(input.base).sort())
    messages[key] = hasOwn(input.messages, key) ? input.messages[key] : '';
  return {
    format: LANGUAGE_PACK_FORMAT,
    formatVersion: LANGUAGE_PACK_FORMAT_VERSION,
    locale: input.locale,
    name: input.name,
    nativeName: input.nativeName,
    baseLocale: BASE_LOCALE,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    messages,
  };
}

/** Parses a JSON pack and checks it targets `expectedLocale`. */
export function parseJsonPack(content: string, expectedLocale: string): LanguagePack {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new LanguagePackError('Dosya geçerli bir JSON değil.');
  }
  const parsed = LanguagePackSchema.safeParse(data);
  if (!parsed.success) {
    throw new LanguagePackError('Dosya dil paketi biçimine uymuyor.');
  }
  if (parsed.data.locale !== expectedLocale) {
    throw new LanguagePackError(`Dosya "${parsed.data.locale}" diline ait; "${expectedLocale}" diline yüklenemez.`);
  }
  return parsed.data;
}

export class LanguagePackError extends Error {}

// CSV ------------------------------------------------------------------

const CSV_BOM = '﻿';
const CSV_HEADER = ['key', 'source', 'translation'] as const;
/** Cells starting with these are treated as formulas by spreadsheet apps. */
const FORMULA_START = /^[=+\-@\t\r]/;

function escapeCell(value: string): string {
  // Prefix a quote so a spreadsheet shows the text instead of running it;
  // parseCsvPack strips it again on upload.
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function unescapeFormula(value: string): string {
  return value.length > 1 && value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

export function packToCsv(pack: LanguagePack, base: Readonly<Record<string, string>>): string {
  const lines = [CSV_HEADER.join(',')];
  for (const key of Object.keys(pack.messages)) {
    lines.push(
      [escapeCell(key), escapeCell(hasOwn(base, key) ? base[key] : ''), escapeCell(pack.messages[key])].join(','),
    );
  }
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

/** RFC 4180 reader; accepts comma or semicolon (Excel in Turkish locale) separators. */
export function parseCsvRows(content: string): string[][] {
  const text = content.startsWith(CSV_BOM) ? content.slice(1) : content;
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const separator = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === separator) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new LanguagePackError('CSV dosyasında kapanmamış tırnak var.');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

export function parseCsvPack(content: string): Record<string, string> {
  const rows = parseCsvRows(content);
  if (rows.length === 0) throw new LanguagePackError('CSV dosyası boş.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const keyIndex = header.indexOf('key');
  const translationIndex = header.indexOf('translation');
  if (keyIndex < 0 || translationIndex < 0) {
    throw new LanguagePackError('CSV başlığında "key" ve "translation" sütunları olmalı.');
  }
  const messages: Record<string, string> = {};
  for (const row of rows.slice(1)) {
    const key = unescapeFormula((row[keyIndex] ?? '').trim());
    if (!key) continue;
    if (!MessageKeySchema.safeParse(key).success) {
      throw new LanguagePackError(`Geçersiz anahtar: ${key.slice(0, 80)}`);
    }
    const value = unescapeFormula(row[translationIndex] ?? '');
    if (value.length > TRANSLATION_MAX_LENGTH) {
      throw new LanguagePackError(`"${key}" çevirisi çok uzun.`);
    }
    messages[key] = value;
  }
  return messages;
}
