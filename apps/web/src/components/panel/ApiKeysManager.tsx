'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_KEY_GRANTABLE_PERMISSIONS, API_KEY_HEADER } from '@resget/shared';
import type { ApiKeyDTO, ApiKeyPermission, CreatedApiKeyDTO } from '@resget/shared';
import { Badge, Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** PRO API access (docs/API_ERISIMI.md): mint a scoped key, read it once, revoke it. */
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
  const [created, setCreated] = useState<CreatedApiKeyDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

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
        body: JSON.stringify({ name: name.trim(), permissions: [...granted] }),
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
            {keys.map((key) => (
              <li key={key.id} className="flex flex-col gap-1" aria-label={key.name}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="ui-heading">{key.name}</span>
                    <Badge tone={key.revokedAt ? 'muted' : 'success'}>
                      {key.revokedAt ? t('integrations.list.revoked') : t('integrations.list.active')}
                    </Badge>
                  </span>
                  {!key.revokedAt && (
                    <Button variant="outline" tone="muted" onClick={() => revoke(key.id)} disabled={busy}>
                      {t('integrations.list.revoke')}
                    </Button>
                  )}
                </div>
                <p className="ui-caption">
                  {t('integrations.list.keyId', { keyId: key.keyId })}.{' '}
                  {key.createdBy &&
                    `${t('integrations.list.createdBy', { name: key.createdBy.fullName, date: when(key.createdAt) })}. `}
                  {key.lastUsedAt
                    ? t('integrations.list.lastUsed', { date: when(key.lastUsedAt) })
                    : t('integrations.list.neverUsed')}
                </p>
                <p className="ui-caption">{key.permissions.map((p) => t(`permissions.${p}`)).join(', ')}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
