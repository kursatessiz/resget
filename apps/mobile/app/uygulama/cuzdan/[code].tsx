import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WalletProviderSchema, walletLinkPayload } from '@resget/shared';
import type { WalletsDTO } from '@resget/shared';
import { Body, Button, Notice, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSession } from '@/state/session';

/**
 * Where a wallet brings the customer back after linking from the app
 * (docs/CUZDAN.md, "Mobil uygulama"): the universal link
 * `/uygulama/cuzdan/<code>` or `resget://uygulama/cuzdan/<code>`. What the
 * wallet put on the address completes the link for the signed-in account,
 * then the orders screen shows the new cards.
 */
export default function WalletLinkReturn() {
  const t = useT();
  const router = useRouter();
  const { ready, me, api } = useSession();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(false);
  const code = WalletProviderSchema.safeParse(params.code);

  useEffect(() => {
    if (!ready || !me || !code.success || sent.current) return;
    sent.current = true;
    api
      .request<WalletsDTO>(`me/wallets/${code.data}/link/complete`, {
        method: 'POST',
        body: { payload: walletLinkPayload(params) },
      })
      .then(() => router.replace('/(app)/siparislerim'))
      .catch((err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('mobile.error.network')));
  }, [ready, me, code, api, params, router, t]);

  const back = () => router.replace('/(app)/siparislerim');
  if (ready && !me) {
    return (
      <Screen>
        <Title>{t('wallets.title')}</Title>
        <Notice tone="error">{t('errors.UNAUTHORIZED')}</Notice>
        <Button label={t('mobile.signIn.verify')} onPress={() => router.replace('/giris')} />
      </Screen>
    );
  }
  return (
    <Screen>
      <Title>{t('wallets.title')}</Title>
      {!code.success && <Notice tone="error">{t('errors.WALLET_UNAVAILABLE')}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {code.success && !error && <Body muted>{t('wallets.app.linking')}</Body>}
      {(error || !code.success) && <Button label={t('wallets.app.back')} onPress={back} />}
    </Screen>
  );
}
