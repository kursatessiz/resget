import { z } from 'zod';

/**
 * Platform languages. Turkish is the base language: every message key is
 * defined in Turkish first (messages/tr), and any key a language pack lacks
 * falls back to Turkish at render time.
 *
 * Languages are platform data managed by the super admin (not tenant data):
 * a `Language` row per code plus `TranslationOverride` rows holding values
 * edited in the CMS or uploaded as a language pack. Languages that ship with
 * the code (tr, en) have bundled messages; the overrides are layered on top.
 */
export const BASE_LOCALE = 'tr' as const;

/** ISO 639-1/639-2 language with an optional ISO 3166 region, e.g. "en", "de", "pt-BR". */
export const LocaleCodeSchema = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Geçersiz dil kodu');
export type LocaleCode = z.infer<typeof LocaleCodeSchema>;

export interface LanguageDTO {
  code: string;
  /** English name, e.g. "German". */
  name: string;
  /** Name in the language itself, e.g. "Deutsch"; shown in language pickers. */
  nativeName: string;
  isEnabled: boolean;
  /** True only for the base language (tr), which cannot be disabled. */
  isBase: boolean;
  /** True when the code ships bundled messages (tr, en). */
  isBundled: boolean;
}

/** Super-admin list row: adds translation progress. */
export interface AdminLanguageDTO extends LanguageDTO {
  /** Share of base keys with a non-empty value in this language, 0..1. */
  completion: number;
  translatedKeys: number;
  totalKeys: number;
  updatedAt: string;
}

/** GET /i18n/languages (public): the enabled languages, base first. */
export interface PublicLanguagesDTO {
  baseLocale: string;
  items: Pick<LanguageDTO, 'code' | 'name' | 'nativeName'>[];
}

/**
 * GET /i18n/messages/:locale (public). `messages` holds only this locale's
 * own values (bundled merged with overrides); clients merge it over the
 * bundled base messages. `version` changes whenever any value changes and
 * is also sent as the ETag.
 */
export interface LocaleMessagesDTO {
  locale: string;
  version: string;
  messages: Record<string, string>;
}

export const CreateLanguageSchema = z
  .object({
    code: LocaleCodeSchema,
    name: z.string().trim().min(1).max(60),
    nativeName: z.string().trim().min(1).max(60),
  })
  .strict();
export type CreateLanguageInput = z.infer<typeof CreateLanguageSchema>;

export const UpdateLanguageSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    nativeName: z.string().trim().min(1).max(60).optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict();
export type UpdateLanguageInput = z.infer<typeof UpdateLanguageSchema>;

/** One key in the CMS editor. */
export interface TranslationEntryDTO {
  key: string;
  /** Turkish source text. */
  base: string;
  /** Value shipped with the code for this language, if any. */
  bundled: string | null;
  /** Value set in the CMS or by an uploaded pack, if any. */
  override: string | null;
  /** What users see: override, else bundled, else null (falls back to base). */
  effective: string | null;
  /** `{name}` placeholders the value must keep. */
  placeholders: string[];
  /** Where the override came from; null without an override. */
  source: 'MANUAL' | 'UPLOAD' | 'AI' | null;
  /** When a person approved the override; null for machine translations still to review. */
  reviewedAt: string | null;
  /** A plural form the base lacks but this language needs (e.g. ".few"). */
  isPluralExtension: boolean;
}

export const TranslationEntriesQuerySchema = z
  .object({
    /** Case-insensitive match on key, base text or effective value. */
    q: z.string().trim().max(100).optional(),
    /** Only keys with no effective value. */
    missingOnly: z.coerce.boolean().optional(),
    /** Key prefix such as "nav" or "members.card". */
    namespace: z
      .string()
      .trim()
      .max(60)
      .regex(/^[a-zA-Z0-9_.]*$/)
      .optional(),
    /** AI_UNREVIEWED lists machine translations nobody approved yet. */
    source: z.enum(['MANUAL', 'UPLOAD', 'AI', 'AI_UNREVIEWED']).optional(),
  })
  .strict();
export type TranslationEntriesQuery = z.infer<typeof TranslationEntriesQuerySchema>;

/** PUT one key; `value: null` removes the override (falls back to bundled or base). */
export const UpsertTranslationSchema = z
  .object({
    value: z.string().max(2000).nullable(),
  })
  .strict();
export type UpsertTranslationInput = z.infer<typeof UpsertTranslationSchema>;

/** PUT /me/locale: null follows the active restaurant's default. Returns { locale }. */
export const UpdateMyLocaleSchema = z
  .object({
    locale: LocaleCodeSchema.nullable(),
  })
  .strict();
export type UpdateMyLocaleInput = z.infer<typeof UpdateMyLocaleSchema>;

/** PUT /restaurants/:restaurantId/locale: must be an enabled language. Returns { defaultLocale }. */
export const UpdateStudioLocaleSchema = z
  .object({
    defaultLocale: LocaleCodeSchema,
  })
  .strict();
export type UpdateStudioLocaleInput = z.infer<typeof UpdateStudioLocaleSchema>;

/**
 * Picks the language to render: the user's own choice, then the restaurant's
 * default, then the device/browser preferences, then the base language.
 * Only enabled codes are accepted at each step; a region-qualified request
 * such as "en-GB" matches an enabled "en".
 */
export function resolveLocale(
  enabled: readonly string[],
  candidates: ReadonlyArray<string | null | undefined>,
): string {
  const set = new Set(enabled);
  for (const raw of candidates) {
    if (!raw) continue;
    if (set.has(raw)) return raw;
    const language = raw.split('-')[0].toLowerCase();
    if (set.has(language)) return language;
  }
  return BASE_LOCALE;
}

/** Parses an Accept-Language header into codes ordered by quality. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((entry) => entry.tag && entry.tag !== '*' && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => {
      const [language, region] = entry.tag.split('-');
      return region ? `${language.toLowerCase()}-${region.toUpperCase()}` : language.toLowerCase();
    });
}
