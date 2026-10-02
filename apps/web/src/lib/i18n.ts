import { cookies, headers } from 'next/headers';
import {
  BASE_LOCALE,
  BUNDLED_LANGUAGES,
  BUNDLED_MESSAGES,
  createTranslator,
  parseAcceptLanguage,
  resolveLocale,
} from '@resget/shared';
import type { Translate } from '@resget/shared';

export const LOCALE_COOKIE = 'resget_locale';

const ENABLED = BUNDLED_LANGUAGES.map((l) => l.code);

/** The viewer's language: an explicit cookie, then the browser preference, then Turkish. */
export async function getLocale(): Promise<string> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  return resolveLocale(ENABLED, [
    cookieStore.get(LOCALE_COOKIE)?.value,
    ...parseAcceptLanguage(headerStore.get('accept-language')),
  ]);
}

/** Server-side translator. Screens never hardcode user-visible text (CLAUDE.md rule 11). */
export async function getT(localeOverride?: string): Promise<{ t: Translate; locale: string }> {
  const locale = localeOverride ?? (await getLocale());
  const messages = BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE];
  return { t: createTranslator({ locale, messages, fallback: BUNDLED_MESSAGES[BASE_LOCALE] }), locale };
}
