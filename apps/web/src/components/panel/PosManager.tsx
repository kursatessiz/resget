'use client';

import { useCallback, useEffect, useState } from 'react';
import { POS_PREP_MINUTES_DEFAULT } from '@resget/shared';
import type { PosSettingsDTO } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * The restaurant's POS connection (docs/POS_ENTEGRASYONU.md): pick the POS,
 * enter its connection details, choose automatic acceptance and the default
 * preparation time, and see the latest deliveries. Partner POS systems are
 * listed as coming until their adapters exist.
 */
export function PosManager({
  restaurantId,
  locale,
  apiBaseUrl,
}: {
  restaurantId: string;
  locale: string;
  apiBaseUrl: string;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/pos`;
  const [data, setData] = useState<PosSettingsDTO | null>(null);
  const [providerCode, setProviderCode] = useState('MOCK');
  const [storeId, setStoreId] = useState('');
  const [secret, setSecret] = useState('');
  const [autoAccept, setAutoAccept] = useState(false);
  const [prepMinutes, setPrepMinutes] = useState(String(POS_PREP_MINUTES_DEFAULT));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const show = (next: PosSettingsDTO) => {
    setData(next);
    if (next.connection) {
      setAutoAccept(next.connection.autoAccept);
      setPrepMinutes(String(next.connection.defaultPrepMinutes));
    }
  };

  useEffect(() => {
    bffJson<PosSettingsDTO>(base).then(show).catch(fail);
    // show only sets state; the base is fixed for the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, fail]);

  const call = async (method: 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      show(await bffJson<PosSettingsDTO>(base, { method, ...(body ? { body: JSON.stringify(body) } : {}) }));
      setNotice(t('integrations.pos.saved'));
      setSecret('');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <p role="alert">{error}</p> : null;
  const connection = data.connection;
  const minutes = Number(prepMinutes);
  const validMinutes = Number.isInteger(minutes) && minutes >= 5 && minutes <= 120;
  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });

  return (
    <Card
      title={t('integrations.pos.title')}
      aria-label={t('integrations.pos.title')}
      aside={
        connection ? (
          <Badge tone={connection.status === 'ACTIVE' && connection.isActive ? 'success' : 'warn'} data-pos-status>
            {connection.isActive ? connection.label : t('integrations.pos.paused')}
          </Badge>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        <p className="ui-caption">{t('integrations.pos.intro')}</p>
        {connection?.status === 'ACTIVE' && <p>{t('integrations.pos.active', { label: connection.label })}</p>}
        {connection?.status === 'FAILED' && (
          <p role="alert">{t('integrations.pos.failed', { reason: connection.failureReason ?? '' })}</p>
        )}
        {connection && (
          <p className="ui-caption" data-pos-webhook>
            {t('integrations.pos.webhook', { url: `${apiBaseUrl}${connection.webhookPath}` })}
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField
            id="pos-provider"
            label={t('integrations.pos.provider')}
            value={providerCode}
            onChange={(event) => setProviderCode(event.target.value)}
          >
            {data.providers.map((p) => (
              <option key={p.code} value={p.code} disabled={!p.available}>
                {p.available ? p.name : t('integrations.pos.comingSoon', { name: p.name })}
              </option>
            ))}
          </SelectField>
          <TextField
            id="pos-prep"
            label={t('integrations.pos.prepMinutes')}
            inputMode="numeric"
            value={prepMinutes}
            onChange={(event) => setPrepMinutes(event.target.value)}
          />
          <TextField
            id="pos-store"
            label={t('integrations.pos.storeId')}
            value={storeId}
            autoComplete="off"
            onChange={(event) => setStoreId(event.target.value)}
          />
          <TextField
            id="pos-secret"
            label={t('integrations.pos.secret')}
            type="password"
            value={secret}
            autoComplete="new-password"
            onChange={(event) => setSecret(event.target.value)}
          />
          <label className="flex items-center gap-2 md:col-span-2">
            <input
              type="checkbox"
              className="pui-checkbox"
              checked={autoAccept}
              onChange={(event) => setAutoAccept(event.target.checked)}
            />
            <span>{t('integrations.pos.autoAccept')}</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !validMinutes || storeId.trim() === ''}
            onClick={() =>
              void call('PUT', {
                providerCode,
                credentials: { storeId: storeId.trim(), ...(secret ? { secret } : {}) },
                autoAccept,
                defaultPrepMinutes: minutes,
              })
            }
          >
            {t('integrations.pos.connect')}
          </Button>
          {connection && (
            <>
              <Button
                variant="outline"
                tone="muted"
                disabled={busy || !validMinutes}
                onClick={() => void call('PATCH', { autoAccept, defaultPrepMinutes: minutes })}
              >
                {t('integrations.pos.save')}
              </Button>
              <Button
                variant="outline"
                tone="warn"
                disabled={busy}
                onClick={() => void call('PATCH', { isActive: !connection.isActive })}
              >
                {connection.isActive ? t('integrations.pos.pause') : t('integrations.pos.resume')}
              </Button>
              <Button variant="outline" tone="error" disabled={busy} onClick={() => void call('DELETE')}>
                {t('integrations.pos.disconnect')}
              </Button>
            </>
          )}
        </div>
        {connection && connection.recent.length > 0 && (
          <section className="flex flex-col gap-2" aria-label={t('integrations.pos.recent')}>
            <span className="ui-heading">{t('integrations.pos.recent')}</span>
            <ul className="ui-divide">
              {connection.recent.map((sync) => (
                <li
                  key={`${sync.orderShortCode}-${sync.updatedAt}`}
                  className="flex flex-wrap justify-between gap-2 py-2"
                >
                  <span>{sync.orderShortCode}</span>
                  <span className="ui-caption">
                    {t(`integrations.pos.sync.${sync.status}`, { attempts: sync.attempts })}
                    {sync.lastError ? ` / ${sync.lastError}` : ''} / {time.format(new Date(sync.updatedAt))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </Card>
  );
}
