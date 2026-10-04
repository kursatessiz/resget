'use client';

import { useCallback, useEffect, useState } from 'react';
import { WEBHOOK_EVENTS } from '@resget/shared';
import type { CreatedWebhookDTO, WebhookDTO, WebhookDeliveryDTO, WebhookEvent } from '@resget/shared';
import { Badge, Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** Outbound webhooks (docs/API_ERISIMI.md): register a URL, read the secret once, follow deliveries, pause or delete. */
export function WebhooksManager({
  restaurantId,
  locale,
  isPro,
}: {
  restaurantId: string;
  locale: string;
  isPro: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/webhooks`;
  const [hooks, setHooks] = useState<WebhookDTO[] | null>(null);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Set<WebhookEvent>>(() => new Set(['order.updated']));
  const [created, setCreated] = useState<CreatedWebhookDTO | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, WebhookDeliveryDTO[]>>({});
  const [openDeliveries, setOpenDeliveries] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  const load = useCallback(async () => setHooks(await bffJson<WebhookDTO[]>(base)), [base]);

  useEffect(() => {
    if (!isPro) {
      setHooks([]);
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
      const hook = await bffJson<CreatedWebhookDTO>(base, {
        method: 'POST',
        body: JSON.stringify({ url: url.trim(), events: [...events] }),
      });
      setCreated(hook);
      setUrl('');
      setNotice(t('integrations.webhooks.created'));
    });
  const toggle = (hook: WebhookDTO) =>
    act(async () => {
      await bffJson<WebhookDTO>(`${base}/${hook.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !hook.isActive }),
      });
    });
  const remove = (hook: WebhookDTO) =>
    act(async () => {
      await bffJson<void>(`${base}/${hook.id}`, { method: 'DELETE' });
      if (created?.id === hook.id) setCreated(null);
      setNotice(t('integrations.webhooks.removed'));
    });
  const test = (hook: WebhookDTO) =>
    act(async () => {
      await bffJson<WebhookDeliveryDTO>(`${base}/${hook.id}/test`, { method: 'POST', body: '{}' });
      setNotice(t('integrations.webhooks.tested'));
    });
  const showDeliveries = (hook: WebhookDTO) =>
    act(async () => {
      if (openDeliveries === hook.id) {
        setOpenDeliveries(null);
        return;
      }
      const rows = await bffJson<WebhookDeliveryDTO[]>(`${base}/${hook.id}/deliveries`);
      setDeliveries((d) => ({ ...d, [hook.id]: rows }));
      setOpenDeliveries(hook.id);
    });

  return (
    <Card title={t('integrations.webhooks.title')} aria-label={t('integrations.webhooks.title')}>
      <p className="ui-text-muted">{t('integrations.webhooks.intro')}</p>
      <p className="ui-caption">{t('integrations.webhooks.howto')}</p>
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
      {created && (
        <div className="flex flex-col gap-1">
          <span className="ui-heading">{t('integrations.webhooks.secret')}</span>
          <pre className="pui-card pui-card-content overflow-x-auto" data-webhook-secret>
            {created.secret}
          </pre>
        </div>
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <TextField
          label={t('integrations.webhooks.url')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          inputMode="url"
          maxLength={500}
          disabled={!isPro}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="ui-heading">{t('integrations.webhooks.events')}</legend>
          {WEBHOOK_EVENTS.map((event) => (
            <label key={event} className="flex items-start gap-2">
              <input
                type="checkbox"
                className="pui-checkbox mt-1"
                checked={events.has(event)}
                disabled={!isPro}
                onChange={(e) =>
                  setEvents((set) => {
                    const next = new Set(set);
                    if (e.target.checked) next.add(event);
                    else next.delete(event);
                    return next;
                  })
                }
              />
              <span>{t(`integrations.webhooks.event.${event}`)}</span>
            </label>
          ))}
        </fieldset>
        <div>
          <Button type="submit" disabled={busy || !isPro || url.trim().length < 10 || events.size === 0}>
            {t('integrations.webhooks.create')}
          </Button>
        </div>
      </form>

      {hooks && hooks.length === 0 && <p className="ui-text-muted">{t('integrations.webhooks.empty')}</p>}
      {hooks && hooks.length > 0 && (
        <ul className="ui-divide">
          {hooks.map((hook) => (
            <li key={hook.id} className="flex flex-col gap-2 py-3" aria-label={hook.url}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="ui-heading break-all">{hook.url}</span>
                  <Badge tone={hook.isActive ? 'success' : 'warn'}>
                    {hook.isActive ? t('integrations.webhooks.active') : t('integrations.webhooks.paused')}
                  </Badge>
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button variant="outline" tone="muted" onClick={() => test(hook)} disabled={busy}>
                    {t('integrations.webhooks.test')}
                  </Button>
                  <Button variant="outline" tone="muted" onClick={() => toggle(hook)} disabled={busy}>
                    {hook.isActive ? t('integrations.webhooks.pause') : t('integrations.webhooks.resume')}
                  </Button>
                  <Button variant="outline" tone="muted" onClick={() => showDeliveries(hook)} disabled={busy}>
                    {t('integrations.webhooks.deliveries')}
                  </Button>
                  <Button variant="outline" tone="warn" onClick={() => remove(hook)} disabled={busy}>
                    {t('integrations.webhooks.remove')}
                  </Button>
                </span>
              </div>
              <p className="ui-caption">
                {hook.events.map((e) => t(`integrations.webhooks.event.${e}`)).join(', ')}.{' '}
                {hook.lastDeliveryAt
                  ? t('integrations.webhooks.last', { date: when(hook.lastDeliveryAt), status: hook.lastStatus ?? 0 })
                  : t('integrations.webhooks.neverSent')}
                {hook.failureCount > 0 && `. ${t('integrations.webhooks.failures', { count: hook.failureCount })}`}
              </p>
              {openDeliveries === hook.id && (
                <ul className="flex flex-col gap-1">
                  {(deliveries[hook.id] ?? []).length === 0 && (
                    <li className="ui-caption">{t('integrations.webhooks.deliveriesEmpty')}</li>
                  )}
                  {(deliveries[hook.id] ?? []).map((d) => (
                    <li key={d.id} className="ui-caption">
                      {t('integrations.webhooks.delivery', {
                        event: d.event,
                        status: t(`integrations.webhooks.status.${d.status}`),
                        attempts: d.attempts,
                        response: d.responseStatus ?? 0,
                        date: when(d.createdAt),
                      })}
                      {d.lastError ? ` ${d.lastError}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
