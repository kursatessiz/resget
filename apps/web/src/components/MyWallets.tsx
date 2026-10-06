'use client';

import { useCallback, useEffect, useState } from 'react';
import { WALLET_NAMES, isWalletProvider } from '@resget/shared';
import type { SavedPaymentMethodDTO, WalletDTO, WalletLinkStartDTO, WalletsDTO } from '@resget/shared';
import { Button, Card } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * Platform wallets (docs/CUZDAN.md): link Masterpass or bex once, see and
 * remove the cards they hold. Hidden while the platform offers no wallet
 * and the customer has none.
 */
export function MyWallets({ locale, linked = false }: { locale: string; linked?: boolean }) {
  const t = useT(locale);
  const [data, setData] = useState<WalletsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(linked ? t('wallets.linked') : null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  useEffect(() => {
    bffJson<WalletsDTO>('me/wallets').then(setData).catch(fail);
  }, [fail]);

  if (!data || (data.wallets.length === 0 && data.cards.length === 0)) {
    return error ? <p role="alert">{error}</p> : null;
  }

  const link = async (wallet: WalletDTO) => {
    setBusy(true);
    setError(null);
    try {
      const start = await bffJson<WalletLinkStartDTO>(`me/wallets/${wallet.code}/link`, {
        method: 'POST',
        body: JSON.stringify({ returnUrl: `${window.location.origin}/hesabim/cuzdan/${wallet.code}` }),
      });
      if (start.redirectUrl) window.location.assign(start.redirectUrl);
      else setBusy(false);
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  };
  const remove = async (card: SavedPaymentMethodDTO) => {
    setBusy(true);
    setError(null);
    try {
      await bffJson<null>(`me/payment-methods/${card.id}`, { method: 'DELETE' });
      setData(await bffJson<WalletsDTO>('me/wallets'));
      setStatus(t('wallets.removed'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('wallets.title')} aria-label={t('wallets.title')}>
      <div className="flex flex-col gap-3">
        <p className="ui-caption">{t('wallets.intro')}</p>
        {error && <p role="alert">{error}</p>}
        {status && <p role="status">{status}</p>}
        {data.cards.length === 0 ? (
          <p className="ui-text-muted">{t('wallets.empty')}</p>
        ) : (
          <ul className="ui-divide">
            {data.cards.map((card) => (
              <li
                key={card.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
                data-wallet-card={card.id}
              >
                <span className="flex flex-col">
                  <span>
                    {t('wallets.card', {
                      wallet: isWalletProvider(card.provider) ? WALLET_NAMES[card.provider] : card.provider,
                      brand: card.brand,
                      last4: card.last4,
                    })}
                  </span>
                  <span className="ui-caption">
                    {t('wallets.expires', { month: String(card.expiryMonth).padStart(2, '0'), year: card.expiryYear })}
                  </span>
                </span>
                <Button variant="outline" tone="error" disabled={busy} onClick={() => void remove(card)}>
                  {t('wallets.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {data.wallets.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {data.wallets.map((wallet) => (
              <Button key={wallet.code} variant="soft" disabled={busy} onClick={() => void link(wallet)}>
                {t('wallets.link', { wallet: wallet.name })}
              </Button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
