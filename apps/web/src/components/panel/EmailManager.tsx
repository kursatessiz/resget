'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EmailDomainDTO, EmailSettingsDTO, EmailSuppressionDTO } from '@resget/shared';
import { Badge, Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const STATUS_TONE = { VALID: 'success', PENDING: 'muted', MISSING: 'warn', INVALID: 'error' } as const;
const DOMAIN_TONE = { VERIFIED: 'success', PENDING: 'warn', FAILED: 'error' } as const;

/**
 * The restaurant's email sender (docs/EPOSTA.md): its own domain with the
 * DNS records to publish and their state, a test send, and the addresses
 * that must not be mailed.
 */
export function EmailManager({ restaurantId, locale }: { restaurantId: string; locale: string }) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/email`;
  const [settings, setSettings] = useState<EmailSettingsDTO | null>(null);
  const [domain, setDomain] = useState('');
  const [fromLocalPart, setFromLocalPart] = useState('bilgi');
  const [fromName, setFromName] = useState('');
  const [testTo, setTestTo] = useState('');
  const [suppressEmail, setSuppressEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      bffJson<EmailSettingsDTO>(base)
        .then(setSettings)
        .catch(() => setSettings(null)),
    [base],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      if (done) setNotice(done);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return null;
  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });

  const domainCard = (d: EmailDomainDTO) => (
    <li key={d.id} className="flex flex-col gap-2 py-3" data-email-domain={d.domain}>
      <span className="flex flex-wrap items-center gap-2">
        <span className="ui-heading">{d.domain}</span>
        <Badge tone={DOMAIN_TONE[d.status]}>{t(`email.domain.status.${d.status}`)}</Badge>
      </span>
      <span className="ui-caption">{t('email.domain.from', { from: d.fromAddress, name: d.fromName })}</span>
      <div className="overflow-x-auto">
        <table className="pui-table w-full" aria-label={t('email.domain.records')}>
          <thead>
            <tr>
              <th scope="col">{t('email.domain.kind')}</th>
              <th scope="col">{t('email.domain.type')}</th>
              <th scope="col">{t('email.domain.name')}</th>
              <th scope="col">{t('email.domain.value')}</th>
              <th scope="col">{t('email.domain.state')}</th>
            </tr>
          </thead>
          <tbody>
            {d.records.map((r) => (
              <tr key={`${r.kind}-${r.name}`} data-dns-record={r.kind}>
                <td>{r.kind}</td>
                <td>{r.type}</td>
                <td className="break-all">{r.name}</td>
                <td className="break-all">{r.value}</td>
                <td>
                  <Badge tone={STATUS_TONE[r.status]}>{t(`email.dns.${r.status}`)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.lastCheckedAt && (
        <span className="ui-caption">{t('email.domain.checked', { at: time.format(new Date(d.lastCheckedAt)) })}</span>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          tone="muted"
          disabled={busy}
          onClick={() => void run(() => bffJson(`${base}/domains/${d.id}/verify`, { method: 'POST' }))}
        >
          {t('email.domain.verify')}
        </Button>
        <Button
          variant="link"
          tone="error"
          disabled={busy}
          onClick={() => void run(() => bffJson(`${base}/domains/${d.id}`, { method: 'DELETE' }))}
        >
          {t('email.domain.remove')}
        </Button>
      </div>
    </li>
  );

  const suppressionRow = (s: EmailSuppressionDTO) => (
    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span>
        {s.email}{' '}
        <Badge tone={s.reason === 'UNSUBSCRIBE' ? 'muted' : 'error'}>{t(`email.suppression.${s.reason}`)}</Badge>
      </span>
      {s.reason === 'UNSUBSCRIBE' && (
        <Button
          variant="link"
          tone="muted"
          disabled={busy}
          onClick={() => void run(() => bffJson(`${base}/suppressions/${s.id}`, { method: 'DELETE' }))}
        >
          {t('email.suppression.lift')}
        </Button>
      )}
    </li>
  );

  return (
    <Card title={t('email.title')} aria-label={t('email.title')}>
      <p className="ui-text-muted">{t('email.intro')}</p>
      {!settings.providerReady && <p className="pui-alert pui-warn">{t('email.providerNotReady')}</p>}
      {settings.domains.length > 0 ? (
        <ul className="ui-divide">{settings.domains.map(domainCard)}</ul>
      ) : (
        <form
          className="grid gap-3 md:grid-cols-3"
          aria-label={t('email.domain.add')}
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              bffJson(`${base}/domains`, {
                method: 'POST',
                body: JSON.stringify({
                  domain: domain.trim(),
                  fromLocalPart: fromLocalPart.trim(),
                  fromName: fromName.trim(),
                }),
              }),
            );
          }}
        >
          <TextField label={t('email.domain.domain')} value={domain} onChange={(e) => setDomain(e.target.value)} />
          <TextField
            label={t('email.domain.localPart')}
            value={fromLocalPart}
            onChange={(e) => setFromLocalPart(e.target.value)}
          />
          <TextField
            label={t('email.domain.fromName')}
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
          />
          <div className="md:col-span-3">
            <Button type="submit" disabled={busy || domain.trim().length < 4 || fromName.trim().length < 2}>
              {t('email.domain.add')}
            </Button>
          </div>
        </form>
      )}

      <form
        className="flex flex-col gap-3 md:flex-row md:items-end"
        aria-label={t('email.test.title')}
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const result = await bffJson<{ status: string; errorCode: string | null }>(`${base}/test`, {
              method: 'POST',
              body: JSON.stringify({ to: testTo.trim() }),
            });
            if (result.status !== 'SENT') throw new ApiError(422, result.errorCode ?? 'ERROR');
          }, t('email.test.sent'));
        }}
      >
        <TextField label={t('email.test.to')} type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        <Button type="submit" variant="outline" tone="muted" disabled={busy || !testTo.includes('@')}>
          {t('email.test.send')}
        </Button>
      </form>

      <section className="flex flex-col gap-2" aria-label={t('email.suppression.title')}>
        <h3 className="ui-heading">{t('email.suppression.title')}</h3>
        <p className="ui-caption">{t('email.suppression.intro')}</p>
        {settings.suppressions.length === 0 ? (
          <p className="ui-text-muted">{t('email.suppression.empty')}</p>
        ) : (
          <ul className="ui-divide">{settings.suppressions.map(suppressionRow)}</ul>
        )}
        <form
          className="flex flex-col gap-3 md:flex-row md:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              bffJson(`${base}/suppressions`, {
                method: 'POST',
                body: JSON.stringify({ email: suppressEmail.trim() }),
              }),
            ).then(() => setSuppressEmail(''));
          }}
        >
          <TextField
            label={t('email.suppression.email')}
            type="email"
            value={suppressEmail}
            onChange={(e) => setSuppressEmail(e.target.value)}
          />
          <Button type="submit" variant="outline" tone="muted" disabled={busy || !suppressEmail.includes('@')}>
            {t('email.suppression.add')}
          </Button>
        </form>
      </section>

      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
    </Card>
  );
}
