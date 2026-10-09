import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { WALLET_NAMES, appWalletReturnUrl } from '@resget/shared';
import type { SavedPaymentMethodDTO, WalletDTO, WalletLinkStartDTO, WalletsDTO } from '@resget/shared';
import { Body, Button, Caption, Card, Notice } from '@/components/ui';
import { ApiError } from '@/lib/api';
import type { ApiClient } from '@/lib/api';
import { WEB_BASE_URL } from '@/lib/config';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/theme';

/**
 * The customer's platform wallets in the app (docs/CUZDAN.md, "Mobil
 * uygulama"): link Masterpass or bex in the browser, come back through the
 * app's return link, list and remove the cards. Hidden while no wallet is
 * offered, the same rule as the web account page.
 */
export function WalletsCard({ api, reloadKey }: { api: ApiClient; reloadKey: number }) {
  const t = useT();
  const theme = useTheme();
  const [data, setData] = useState<WalletsDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('mobile.error.network')),
    [t],
  );
  const load = useCallback(async () => {
    try {
      setData(await api.request<WalletsDTO>('me/wallets'));
    } catch (err) {
      fail(err);
    }
  }, [api, fail]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (!data || data.wallets.length === 0) return null;

  const link = async (wallet: WalletDTO) => {
    setBusy(wallet.code);
    setError(null);
    setNotice(null);
    try {
      const start = await api.request<WalletLinkStartDTO>(`me/wallets/${wallet.code}/link`, {
        method: 'POST',
        body: { returnUrl: appWalletReturnUrl(WEB_BASE_URL, wallet.code) },
      });
      if (start.redirectUrl) await Linking.openURL(start.redirectUrl);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (card: SavedPaymentMethodDTO) => {
    setBusy(card.id);
    setError(null);
    setNotice(null);
    try {
      await api.request<null>(`me/payment-methods/${card.id}`, { method: 'DELETE' });
      setNotice(t('wallets.removed'));
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };
  const confirmRemove = (card: SavedPaymentMethodDTO) =>
    Alert.alert(t('wallets.app.removeConfirm'), cardLine(card), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('wallets.remove'), style: 'destructive', onPress: () => void remove(card) },
    ]);
  const walletName = (code: string) => (code in WALLET_NAMES ? WALLET_NAMES[code as WalletDTO['code']] : code);
  const cardLine = (card: SavedPaymentMethodDTO) =>
    t('wallets.card', { wallet: walletName(card.provider), brand: card.brand, last4: card.last4 });

  return (
    <Card title={t('wallets.title')}>
      <Body muted>{t('wallets.intro')}</Body>
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {data.cards.length === 0 && <Caption>{t('wallets.empty')}</Caption>}
      {data.cards.map((card) => (
        <View key={card.id} style={{ gap: theme.spacing[1] }}>
          <Body>{cardLine(card)}</Body>
          <Caption>
            {t('wallets.expires', { month: String(card.expiryMonth).padStart(2, '0'), year: card.expiryYear })}
          </Caption>
          <Button
            label={t('wallets.remove')}
            variant="outline"
            tone="muted"
            busy={busy === card.id}
            disabled={busy !== null}
            onPress={() => confirmRemove(card)}
          />
        </View>
      ))}
      {data.wallets.map((wallet) => (
        <Button
          key={wallet.code}
          label={t('wallets.link', { wallet: wallet.name })}
          busy={busy === wallet.code}
          disabled={busy !== null}
          onPress={() => void link(wallet)}
        />
      ))}
    </Card>
  );
}
