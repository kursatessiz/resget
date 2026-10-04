import { useMemo } from 'react';
import { getLocales } from 'expo-localization';
import { BASE_LOCALE, BUNDLED_MESSAGES, createTranslator } from '@resget/shared';
import type { Translate } from '@resget/shared';

/** The device language when a bundled catalogue exists for it, else the base locale. */
export function deviceLocale(): string {
  const tag = getLocales()[0]?.languageCode ?? BASE_LOCALE;
  return tag in BUNDLED_MESSAGES ? tag : BASE_LOCALE;
}

export function translatorFor(locale: string): Translate {
  return createTranslator({
    locale,
    messages: BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE],
    fallback: BUNDLED_MESSAGES[BASE_LOCALE],
  });
}

export function useT(locale: string = deviceLocale()): Translate {
  return useMemo(() => translatorFor(locale), [locale]);
}
