'use client';

import { useCallback, useEffect, useState } from 'react';
import { OAUTH_RESULTS } from '@resget/shared';
import type { OAuthResult, OAuthStartDTO, SocialAccountDTO } from '@resget/shared';
import { Badge, Button, Card } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * Integration hub (docs/ENTEGRASYON_MERKEZI.md): connect Facebook pages and
 * their Instagram business accounts through Meta's consent screen, then
 * choose which ones Lead Ads and publishing may use. Tokens never reach the
 * browser.
 */
export function SocialAccountsManager({
  restaurantId,
  locale,
  returnPath,
  result,
  leadAds = false,
}: {
  restaurantId: string;
  locale: string;
  /** This screen's own path; Meta sends the browser back here. */
  returnPath: string;
  /** The `meta` query parameter after the round trip, if any. */
  result: string | null;
  /** Lead Ads is on: Facebook pages get an import switch (docs/LEAD_ADS.md). */
  leadAds?: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/social`;
  const [accounts, setAccounts] = useState<SocialAccountDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const outcome = (OAUTH_RESULTS as readonly string[]).includes(result ?? '') ? (result as OAuthResult) : null;

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const load = useCallback(
    () => bffJson<SocialAccountDTO[]>(`${base}/accounts`).then(setAccounts).catch(fail),
    [base, fail],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const start = await bffJson<OAuthStartDTO>(`${base}/meta/connect`, {
        method: 'POST',
        body: JSON.stringify({ returnPath }),
      });
      window.location.assign(start.authorizeUrl);
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  };
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

  return (
    <Card title={t('social.title')} aria-label={t('social.title')}>
      <p className="ui-text-muted">{t('social.intro')}</p>
      {outcome && (
        <p
          role="status"
          className={`pui-alert ${outcome === 'connected' ? 'pui-success' : 'pui-error'}`}
          data-social-result={outcome}
        >
          {t(`social.result.${outcome}`)}
        </p>
      )}
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      <div>
        <Button onClick={() => void connect()} disabled={busy}>
          {accounts && accounts.length > 0 ? t('social.reconnect') : t('social.connect')}
        </Button>
      </div>
      {accounts && accounts.length === 0 && <p className="ui-caption">{t('social.empty')}</p>}
      {accounts && accounts.length > 0 && (
        <ul className="flex flex-col ui-divide">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
              data-social-account={account.externalId}
            >
              <span className="flex flex-col">
                <span className="ui-heading">{account.name}</span>
                <span className="ui-caption">
                  {t(`social.kind.${account.kind}`)} · {t('social.connectedAt', { date: date(account.connectedAt) })}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={account.status === 'ACTIVE' ? 'success' : 'warn'}>
                  {t(`social.status.${account.status}`)}
                </Badge>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="pui-checkbox"
                    checked={account.enabled}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      // Shown at once; the list is reloaded from the server either way.
                      setAccounts((current) =>
                        (current ?? []).map((a) =>
                          a.id === account.id ? { ...a, enabled, leadsEnabled: enabled && a.leadsEnabled } : a,
                        ),
                      );
                      void act(() =>
                        bffJson<SocialAccountDTO>(`${base}/accounts/${account.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ enabled }),
                        }),
                      );
                    }}
                  />
                  <span>{t('social.enabled')}</span>
                </label>
                {leadAds && account.kind === 'FACEBOOK_PAGE' && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="pui-checkbox"
                      checked={account.leadsEnabled}
                      disabled={busy || !account.enabled}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setAccounts((current) =>
                          (current ?? []).map((a) => (a.id === account.id ? { ...a, leadsEnabled: enabled } : a)),
                        );
                        void act(() =>
                          bffJson<SocialAccountDTO>(`restaurants/${restaurantId}/lead-ads/pages/${account.id}`, {
                            method: 'PUT',
                            body: JSON.stringify({ enabled }),
                          }),
                        );
                      }}
                    />
                    <span>{t('leadAds.pageToggle')}</span>
                  </label>
                )}
                <Button
                  variant="outline"
                  tone="error"
                  disabled={busy}
                  onClick={() => void act(() => bffJson<void>(`${base}/accounts/${account.id}`, { method: 'DELETE' }))}
                >
                  {t('social.disconnect')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
