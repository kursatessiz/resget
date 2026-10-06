'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  API_KEY_EXPIRY_DAYS,
  API_KEY_GRANTABLE_PERMISSIONS,
  API_KEY_HEADER,
  API_KEY_USAGE_DAYS,
  apiKeyStatus,
} from '@resget/shared';
import type { ApiKeyDTO, ApiKeyExpiryDays, ApiKeyPermission, ApiKeyUsageDTO, CreatedApiKeyDTO } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** PRO API access (docs/API_ERISIMI.md): mint a scoped key with an optional lifetime, read it once, see its use, revoke it. */
export function ApiKeysManager({
  restaurantId,
  locale,
  isPro,
  apiBaseUrl,
}: {
  restaurantId: string;
  locale: string;
  isPro: boolean;
  apiBaseUrl: string;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/api-keys`;
  const [keys, setKeys] = useState<ApiKeyDTO[] | null>(null);
  const [name, setName] = useState('');
  const [granted, setGranted] = useState<Set<ApiKeyPermission>>(() => new Set(['orders.view', 'menu.view']));
  const [expiresInDays, setExpiresInDays] = useState<ApiKeyExpiryDays | null>(null);
  const [created, setCreated] = useState<CreatedApiKeyDTO | null>(null);
  const [usage, setUsage] = useState<ApiKeyUsageDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  // Usage days are UTC calendar days; formatting them in UTC keeps the date the API counted.
  const dayOf = (day: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
  const number = (n: number) => new Intl.NumberFormat(locale).format(n);

  const load = useCallback(async () => setKeys(await bffJson<ApiKeyDTO[]>(base)), [base]);

  useEffect(() => {
    if (!isPro) {
      setKeys([]);
      return;
    }
    load().catch(fail);
  }, [load, fail, isPro]);

  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await run();
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    act(async () => {
      const key = await bffJson<CreatedApiKeyDTO>(base, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), permissions: [...granted], expiresInDays }),
      });
      setCreated(key);
      setName('');
      setNotice(t('integrations.new.created'));
    });
  const revoke = (id: string) =>
    act(async () => {
      await bffJson<ApiKeyDTO>(`${base}/${id}/revoke`, { method: 'POST', body: '{}' });
      if (created?.id === id) setCreated(null);
      setNotice(t('integrations.list.revokedNotice'));
    });
  const toggleUsage = async (id: string) => {
    if (usage?.id === id) {
      setUsage(null);
      return;
    }
    setError(null);
    try {
      setUsage(await bffJson<ApiKeyUsageDTO>(`${base}/${id}/usage`));
    } catch (err) {
      fail(err);
    }
  };
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('integrations.title')}</h1>
        <p className="ui-text-muted">{t('integrations.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="pui-alert pui-success">
          {notice}
        </p>
      )}
      {!isPro && <p className="pui-alert pui-warning">{t('integrations.proRequired')}</p>}

      <Card title={t('integrations.howto.title')} aria-label={t('integrations.howto.title')}>
        <ul className="ui-divide">
          <li className="py-2">{t('integrations.howto.base', { url: apiBaseUrl })}</li>
          <li className="py-2">{t('integrations.howto.header', { header: API_KEY_HEADER })}</li>
          <li className="py-2">{t('integrations.howto.docs')}</li>
        </ul>
      </Card>

      {created && (
        <Card title={t('integrations.new.token')} aria-label={t('integrations.new.token')}>
          <p className="ui-caption">{t('integrations.new.created')}</p>
          <pre className="pui-card pui-card-content overflow-x-auto" data-api-key-token>
            {created.token}
          </pre>
        </Card>
      )}

      <Card title={t('integrations.new.title')} aria-label={t('integrations.new.title')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <TextField
            label={t('integrations.new.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            disabled={!isPro}
          />
          <fieldset className="grid gap-2 md:grid-cols-2">
            <legend className="ui-heading">{t('integrations.new.permissions')}</legend>
            {API_KEY_GRANTABLE_PERMISSIONS.map((key) => (
              <label key={key} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="pui-checkbox mt-1"
                  checked={granted.has(key)}
                  disabled={!isPro}
                  onChange={(e) =>
                    setGranted((g) => {
                      const next = new Set(g);
                      if (e.target.checked) next.add(key);
                      else next.delete(key);
                      return next;
                    })
                  }
                />
                <span>{t(`permissions.${key}`)}</span>
              </label>
            ))}
          </fieldset>
          <SelectField
            label={t('integrations.new.expiry')}
            value={expiresInDays === null ? '' : String(expiresInDays)}
            onChange={(e) =>
              setExpiresInDays(e.target.value === '' ? null : (Number(e.target.value) as ApiKeyExpiryDays))
            }
            disabled={!isPro}
          >
            <option value="">{t('integrations.new.expiryNever')}</option>
            {API_KEY_EXPIRY_DAYS.map((days) => (
              <option key={days} value={days}>
                {t('integrations.new.expiryDays', { days })}
              </option>
            ))}
          </SelectField>
          <div>
            <Button type="submit" disabled={busy || !isPro || name.trim().length < 2 || granted.size === 0}>
              {t('integrations.new.create')}
            </Button>
          </div>
        </form>
      </Card>

      <Card title={t('integrations.list.title')} aria-label={t('integrations.list.title')}>
        {keys && keys.length === 0 && <p className="ui-text-muted">{t('integrations.list.empty')}</p>}
        {keys && keys.length > 0 && (
          <ul className="flex flex-col gap-3">
            {keys.map((key) => {
              const status = apiKeyStatus(key, now);
              return (
                <li key={key.id} className="flex flex-col gap-1" aria-label={key.name} data-api-key-status={status}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="ui-heading">{key.name}</span>
                      <Badge tone={status === 'ACTIVE' ? 'success' : status === 'EXPIRED' ? 'warn' : 'muted'}>
                        {status === 'ACTIVE'
                          ? t('integrations.list.active')
                          : status === 'EXPIRED'
                            ? t('integrations.list.expired')
                            : t('integrations.list.revoked')}
                      </Badge>
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <Button variant="outline" tone="muted" onClick={() => void toggleUsage(key.id)}>
                        {usage?.id === key.id ? t('integrations.usage.hide') : t('integrations.usage.show')}
                      </Button>
                      {!key.revokedAt && (
                        <Button variant="outline" tone="muted" onClick={() => revoke(key.id)} disabled={busy}>
                          {t('integrations.list.revoke')}
                        </Button>
                      )}
                    </span>
                  </div>
                  <p className="ui-caption">
                    {t('integrations.list.keyId', { keyId: key.keyId })}.{' '}
                    {key.createdBy &&
                      `${t('integrations.list.createdBy', { name: key.createdBy.fullName, date: when(key.createdAt) })}. `}
                    {key.lastUsedAt
                      ? t('integrations.list.lastUsed', { date: when(key.lastUsedAt) })
                      : t('integrations.list.neverUsed')}
                  </p>
                  <p className="ui-caption" data-api-key-usage-summary>
                    {key.expiresAt
                      ? t(status === 'EXPIRED' ? 'integrations.list.expiredAt' : 'integrations.list.expiresAt', {
                          date: when(key.expiresAt),
                        })
                      : t('integrations.list.noExpiry')}
                    .{' '}
                    {t('integrations.list.requests', {
                      count: key.requestsLastDays,
                      days: API_KEY_USAGE_DAYS,
                    })}
                  </p>
                  <p className="ui-caption">{key.permissions.map((p) => t(`permissions.${p}`)).join(', ')}</p>
                  {usage?.id === key.id && (
                    <section aria-label={t('integrations.usage.title')} className="flex flex-col gap-1">
                      <h3 className="ui-heading">{t('integrations.usage.title')}</h3>
                      {usage.total === 0 ? (
                        <p className="ui-text-muted">{t('integrations.usage.empty')}</p>
                      ) : (
                        <ul className="ui-divide" data-api-key-usage>
                          {usage.days
                            .filter((d) => d.requests > 0)
                            .map((d) => (
                              <li key={d.day} className="py-1">
                                {t('integrations.usage.day', { date: dayOf(d.day), requests: number(d.requests) })}
                              </li>
                            ))}
                        </ul>
                      )}
                    </section>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
