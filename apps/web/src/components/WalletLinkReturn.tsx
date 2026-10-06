'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WalletProviderCode, WalletsDTO } from '@resget/shared';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * The wallet sends the customer back here after linking in its own UI
 * (docs/CUZDAN.md); whatever it put on the address goes to the API, then
 * the account page shows the new cards.
 */
export function WalletLinkReturn({
  code,
  payload,
  locale,
}: {
  code: WalletProviderCode;
  payload: Record<string, string>;
  locale: string;
}) {
  const t = useT(locale);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bffJson<WalletsDTO>(`me/wallets/${code}/link/complete`, { method: 'POST', body: JSON.stringify({ payload }) })
      .then(() => router.replace('/hesabim?cuzdan=eklendi'))
      .catch((err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')));
  }, [code, payload, router, t]);

  return error ? <p role="alert">{error}</p> : <p role="status">{t('common.loading')}</p>;
}
