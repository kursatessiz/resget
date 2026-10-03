'use client';

import { useMemo } from 'react';
import { BASE_LOCALE, BUNDLED_MESSAGES, createTranslator } from '@resget/shared';
import type { Translate } from '@resget/shared';

/** Client-side translator for the viewer's locale; server components use getT() instead. */
export function useT(locale: string): Translate {
  return useMemo(
    () =>
      createTranslator({
        locale,
        messages: BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE],
        fallback: BUNDLED_MESSAGES[BASE_LOCALE],
      }),
    [locale],
  );
}
