'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type { AdminPayoutDTO, AdminPayoutPageDTO, PayoutRunReportDTO } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const STATUSES = ['SCHEDULED', 'SENT', 'SETTLED', 'FAILED'] as const;
const STATUS_TONE: Record<AdminPayoutDTO['status'], UiTone> = {
  SCHEDULED: 'warn',
  SENT: 'warn',
  SETTLED: 'success',
  FAILED: 'error',
};

/** Every payout on the platform: close the week, mark transfers sent, settled or failed. */
export function AdminPayouts({ locale }: { locale: string }) {
  const t = useT(locale);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState<AdminPayoutPageDTO | null>(null);
  const [report, setReport] = useState<PayoutRunReportDTO | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  const money = (amountMinor: number, currency: string) => formatMoney({ amountMinor, currency }, locale);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ page: '1', pageSize: '50' });
    if (status) query.set('status', status);
    setPage(await bffJson<AdminPayoutPageDTO>(`admin/payouts?${query.toString()}`));
  }, [status]);
  useEffect(() => {
    load().catch(fail);
  }, [load, fail]);

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
  const run = () =>
    act(async () => {
      setReport(await bffJson<PayoutRunReportDTO>('admin/payouts/run', { method: 'POST', body: '{}' }));
    });
  const mark = (id: string, action: 'sent' | 'settled' | 'failed') =>
    act(async () => {
      const body =
        action === 'sent'
          ? { providerRef: (refs[id] ?? '').trim() }
          : action === 'failed'
            ? { reason: (refs[id] ?? '').trim() }
            : {};
      await bffJson<AdminPayoutDTO>(`admin/payouts/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
      setNotice(t('admin.payouts.updated'));
    });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('admin.payouts.title')}</h1>
        <p className="ui-text-muted">{t('admin.payouts.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {notice && <p className="pui-alert pui-success">{notice}</p>}
      <Card title={t('admin.payouts.run')}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <Button onClick={run} disabled={busy}>
            {t('admin.payouts.run')}
          </Button>
          <SelectField label={t('admin.invoices.filter')} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('admin.invoices.all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`finance.payouts.status.${s}`)}
              </option>
            ))}
          </SelectField>
        </div>
        {report && (
          <p role="status" className="ui-caption">
            {t('admin.payouts.report', {
              created: report.created,
              totals: report.totals.length
                ? report.totals.map((x) => money(x.amountMinor, x.currency)).join(', ')
                : t('admin.payouts.none'),
            })}
          </p>
        )}
      </Card>
      <Card title={t('finance.payouts.title')}>
        {page && page.items.length === 0 && <p className="ui-text-muted">{t('admin.payouts.empty')}</p>}
        {page && page.items.length > 0 && (
          <ul className="flex flex-col gap-4">
            {page.items.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-2 ui-rule pt-3"
                aria-label={`${p.restaurant.name} ${day(p.periodStart)}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="ui-heading">
                    {p.restaurant.name}: {money(p.amountMinor, p.currency)}
                  </span>
                  <Badge tone={STATUS_TONE[p.status]}>{t(`finance.payouts.status.${p.status}`)}</Badge>
                </div>
                <p className="ui-caption">
                  {t('finance.payouts.period', { start: day(p.periodStart), end: day(p.periodEnd) })}.{' '}
                  {t('finance.payouts.scheduledFor', { date: day(p.scheduledFor) })}.{' '}
                  {p.providerRef ? `${p.providerRef}. ` : ''}
                  {p.failureReason ? t('finance.payouts.failed', { reason: p.failureReason }) : ''}
                </p>
                {p.status !== 'SETTLED' && (
                  <div className="flex flex-col gap-3 md:flex-row md:items-end">
                    <TextField
                      label={p.status === 'SENT' ? t('admin.payouts.reason') : t('admin.payouts.providerRef')}
                      value={refs[p.id] ?? ''}
                      onChange={(e) => setRefs((r) => ({ ...r, [p.id]: e.target.value }))}
                    />
                    {p.status !== 'SENT' && (
                      <Button
                        variant="outline"
                        onClick={() => mark(p.id, 'sent')}
                        disabled={busy || (refs[p.id] ?? '').trim().length < 2}
                      >
                        {t('admin.payouts.markSent')}
                      </Button>
                    )}
                    {p.status === 'SENT' && (
                      <Button onClick={() => mark(p.id, 'settled')} disabled={busy}>
                        {t('admin.payouts.markSettled')}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      tone="error"
                      onClick={() => mark(p.id, 'failed')}
                      disabled={busy || (refs[p.id] ?? '').trim().length < 2}
                    >
                      {t('admin.payouts.markFailed')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
