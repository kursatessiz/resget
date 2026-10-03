'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type {
  MessagingOverviewDTO,
  NotificationChannel,
  NotificationSettings,
  PlanCode,
  PurchaseCreditsResultDTO,
  SavedPaymentMethodDTO,
} from '@resget/shared';
import { Badge, Button, Card, SelectField } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const STATUS_TONE: Record<string, UiTone> = { SENT: 'success', DELIVERED: 'success', PENDING: 'warn', FAILED: 'error' };
const LINK_FLAG = 'resget_card_link_pending';

/** Plan, message credit wallets, package purchase through the card vault, notification settings and the message log. */
export function PlanAndCredits({
  restaurantId,
  locale,
  plan,
  canMessaging,
}: {
  restaurantId: string;
  locale: string;
  plan: PlanCode;
  canMessaging: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/messaging`;
  const [data, setData] = useState<MessagingOverviewDTO | null>(null);
  const [cards, setCards] = useState<SavedPaymentMethodDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [packageCode, setPackageCode] = useState('');
  const [cardId, setCardId] = useState('');
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  const loadCards = useCallback(async () => {
    const list = await bffJson<SavedPaymentMethodDTO[]>('me/payment-methods');
    setCards(list);
    setCardId((current) => current || list.find((c) => c.isDefault)?.id || list[0]?.id || '');
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // Returning from the vault's linking page: the callback parameters complete the link.
      let pending = false;
      try {
        pending = window.sessionStorage.getItem(LINK_FLAG) === '1';
      } catch {
        pending = false;
      }
      const params = new URLSearchParams(window.location.search);
      if (pending && [...params.keys()].length > 0) {
        try {
          window.sessionStorage.removeItem(LINK_FLAG);
        } catch {
          // Storage may be unavailable; the flag is only a convenience.
        }
        await bffJson<SavedPaymentMethodDTO[]>('me/payment-methods/link/complete', {
          method: 'POST',
          body: JSON.stringify({ payload: Object.fromEntries(params.entries()) }),
        });
        window.history.replaceState(null, '', window.location.pathname);
      }
      const [overview] = await Promise.all([bffJson<MessagingOverviewDTO>(base), loadCards()]);
      if (cancelled) return;
      setData(overview);
      setSettings(overview.settings);
      setPackageCode((current) => current || overview.packages[0]?.code || '');
    };
    run().catch(fail);
    return () => {
      cancelled = true;
    };
  }, [base, fail, loadCards]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const addCard = () =>
    run(async () => {
      const returnUrl = `${window.location.origin}${window.location.pathname}`;
      const link = await bffJson<{ redirectUrl: string | null }>('me/payment-methods/link', {
        method: 'POST',
        body: JSON.stringify({ returnUrl }),
      });
      try {
        window.sessionStorage.setItem(LINK_FLAG, '1');
      } catch {
        // Without storage the completion step is skipped; the user can retry.
      }
      if (link.redirectUrl) window.location.assign(link.redirectUrl);
    });

  const buy = () =>
    run(async () => {
      const result = await bffJson<PurchaseCreditsResultDTO>(`${base}/purchase`, {
        method: 'POST',
        body: JSON.stringify({
          packageCode,
          paymentMethodId: cardId,
          returnUrl: `${window.location.origin}${window.location.pathname}`,
        }),
      });
      setData((d) => d && { ...d, wallets: result.wallets });
      if (result.status === 'CAPTURED') setNotice(t('messaging.packages.success'));
      else if (result.status === 'REQUIRES_3DS' && result.redirectUrl) {
        setNotice(t('messaging.packages.redirect'));
        window.location.assign(result.redirectUrl);
      } else setError(t('messaging.packages.failed', { code: result.failureCode ?? 'FAILED' }));
    });

  const saveSettings = () =>
    run(async () => {
      if (!settings) return;
      const saved = await bffJson<NotificationSettings>(`${base}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(settings),
      });
      setSettings(saved);
      setSettingsSaved(true);
    });

  if (!data || !settings) {
    return (
      <>
        <h1 className="ui-title">{t('messaging.title')}</h1>
        <p className="ui-text-muted">{error ?? t('common.loading')}</p>
      </>
    );
  }

  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const count = new Intl.NumberFormat(locale);
  const selectedPackage = data.packages.find((p) => p.code === packageCode) ?? null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('messaging.title')}</h1>
        <p className="ui-text-muted">
          {t('messaging.plan.current', { plan: t(`plans.${plan}.name`) })}. {t(`plans.${plan}.summary`)}
        </p>
      </header>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}
      {notice && <p className="ui-caption">{notice}</p>}

      <Card title={t('messaging.wallet.title')} aria-label={t('messaging.wallet.title')}>
        <dl className="grid grid-cols-2 gap-4">
          {data.wallets.map((wallet) => (
            <div key={wallet.channel} className="flex flex-col" data-wallet={wallet.channel}>
              <dt className="ui-caption">{t(`messaging.wallet.channel.${wallet.channel}`)}</dt>
              <dd className="ui-price">{t('messaging.wallet.balance', { count: count.format(wallet.balance) })}</dd>
            </div>
          ))}
        </dl>
        <p className="ui-caption">{t('messaging.wallet.rule')}</p>
      </Card>

      <Card title={t('messaging.packages.title')} aria-label={t('messaging.packages.title')}>
        {data.packages.length === 0 ? (
          <p className="ui-text-muted">{t('messaging.packages.empty')}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField
              id="credit-package"
              label={t('messaging.packages.title')}
              value={packageCode}
              onChange={(e) => setPackageCode(e.target.value)}
            >
              {data.packages.map((pkg) => (
                <option key={pkg.code} value={pkg.code}>
                  {t('messaging.packages.option', {
                    credits: count.format(pkg.credits),
                    channel: t(`messaging.wallet.channel.${pkg.channel}`),
                    price: formatMoney({ amountMinor: pkg.priceMinor, currency: pkg.currency }, locale),
                  })}
                </option>
              ))}
            </SelectField>
            {cards.length > 0 ? (
              <SelectField
                id="credit-card"
                label={t('messaging.packages.card')}
                value={cardId}
                onChange={(e) => setCardId(e.target.value)}
              >
                {cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.brand} **** {card.last4}
                  </option>
                ))}
              </SelectField>
            ) : (
              <p className="ui-text-muted self-end">{t('messaging.packages.noCard')}</p>
            )}
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button onClick={buy} disabled={busy || !selectedPackage || !cardId}>
                {t('messaging.packages.buy')}
              </Button>
              <Button variant="outline" tone="muted" onClick={addCard} disabled={busy}>
                {t('messaging.packages.addCard')}
              </Button>
            </div>
          </div>
        )}
        <p className="ui-caption">{t('payments.cards.vaultNote')}</p>
      </Card>

      {canMessaging && (
        <Card title={t('messaging.settings.title')} aria-label={t('messaging.settings.title')}>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="pui-checkbox mt-1"
              checked={settings.customerOrderUpdates}
              onChange={(e) => {
                setSettingsSaved(false);
                setSettings({ ...settings, customerOrderUpdates: e.target.checked });
              }}
            />
            <span>
              {t('messaging.settings.customerOrderUpdates')}
              <br />
              <span className="ui-caption">{t('messaging.settings.customerOrderUpdatesHelp')}</span>
            </span>
          </label>
          <SelectField
            id="notify-channel"
            label={t('messaging.settings.channel')}
            value={settings.channel}
            onChange={(e) => {
              setSettingsSaved(false);
              setSettings({ ...settings, channel: e.target.value as NotificationChannel });
            }}
          >
            <option value="SMS">{t('messaging.wallet.channel.SMS')}</option>
            <option value="WHATSAPP">{t('messaging.wallet.channel.WHATSAPP')}</option>
          </SelectField>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="pui-checkbox"
              checked={settings.fallbackToSms}
              onChange={(e) => {
                setSettingsSaved(false);
                setSettings({ ...settings, fallbackToSms: e.target.checked });
              }}
            />
            <span>{t('messaging.settings.fallbackToSms')}</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={saveSettings} disabled={busy}>
              {t('common.save')}
            </Button>
            {settingsSaved && <span className="ui-caption">{t('common.saved')}</span>}
          </div>
        </Card>
      )}

      {canMessaging && (
        <Card title={t('messaging.log.title')} aria-label={t('messaging.log.title')}>
          {data.recent.length === 0 && <p className="ui-text-muted">{t('messaging.log.empty')}</p>}
          <ul className="ui-divide">
            {data.recent.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span>{t(`messaging.log.template.${entry.templateKey}`)}</span>
                  <span className="ui-text-muted">{entry.toMasked}</span>
                  <Badge>{t(`messaging.wallet.channel.${entry.channel}`)}</Badge>
                  <Badge tone={STATUS_TONE[entry.status] ?? 'muted'}>{t(`messaging.log.status.${entry.status}`)}</Badge>
                  {entry.errorCode && <span className="ui-caption">{t(`messaging.log.error.${entry.errorCode}`)}</span>}
                </span>
                <span className="ui-caption">
                  {t('messaging.log.credits', { count: entry.creditsCharged })} /{' '}
                  {dateFormat.format(new Date(entry.createdAt))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
