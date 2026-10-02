import { hasOwn } from './own';

/**
 * Message lookup and `{name}` interpolation, shared by web, mobile and API.
 *
 * Plurals: a key that needs plural forms is stored as `<key>.one` and
 * `<key>.other` (plus `.zero`, `.two`, `.few`, `.many` where a language
 * needs them) and called as `t('<key>', { count })`. The form is picked with
 * Intl.PluralRules for the rendering locale; Turkish uses only `.other`
 * after numbers, so both forms may hold the same text there.
 *
 * Values are plain text. Never render them with dangerouslySetInnerHTML or
 * as HTML: an uploaded language pack is external input.
 */

export type MessageParams = Record<string, string | number>;
export type Messages = Readonly<Record<string, string>>;

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

export function interpolate(template: string, params?: MessageParams, locale?: string): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    if (!hasOwn(params, name)) return match;
    const value = params[name];
    return typeof value === 'number' ? formatNumber(value, locale) : value;
  });
}

function formatNumber(value: number, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

/** Placeholder names in a message, sorted and de-duplicated. */
export function placeholdersOf(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) names.add(match[1]);
  return [...names].sort();
}

/** Strips a plural suffix: "members.count.one" -> "members.count". */
export function pluralBaseOf(key: string): string | null {
  const dot = key.lastIndexOf('.');
  if (dot < 0) return null;
  const suffix = key.slice(dot + 1);
  return (PLURAL_SUFFIXES as readonly string[]).includes(suffix) ? key.slice(0, dot) : null;
}

export interface TranslatorOptions {
  locale: string;
  /** This locale's messages. */
  messages: Messages;
  /** Base (Turkish) messages used for missing keys. */
  fallback: Messages;
  /** Called once per missing key, e.g. to log in development. */
  onMissing?: (key: string, locale: string) => void;
}

export type Translate = (key: string, params?: MessageParams) => string;

export function createTranslator(options: TranslatorOptions): Translate {
  const { locale, messages, fallback, onMissing } = options;
  let rules: Intl.PluralRules | null = null;
  const pluralRules = (): Intl.PluralRules => {
    if (!rules) {
      try {
        rules = new Intl.PluralRules(locale);
      } catch {
        rules = new Intl.PluralRules('en');
      }
    }
    return rules;
  };
  const reported = new Set<string>();

  const lookup = (key: string): string | undefined => {
    if (hasOwn(messages, key) && messages[key] !== '') return messages[key];
    if (hasOwn(fallback, key) && fallback[key] !== '') return fallback[key];
    return undefined;
  };

  return (key, params) => {
    let template = lookup(key);
    if (template === undefined && params && typeof params.count === 'number') {
      const form = pluralRules().select(params.count);
      template = lookup(`${key}.${form}`) ?? lookup(`${key}.other`);
    }
    if (template === undefined) {
      if (onMissing && !reported.has(key)) {
        reported.add(key);
        onMissing(key, locale);
      }
      return key;
    }
    return interpolate(template, params, locale);
  };
}
