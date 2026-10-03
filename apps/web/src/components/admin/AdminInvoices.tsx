'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type { AdminInvoiceDTO, AdminInvoicePageDTO, BillingRunReportDTO, PayInvoiceResultDTO } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const STATUSES = ['ISSUED', 'OVERDUE', 'PAID', 'VOID', 'DRAFT'] as const;
const STATUS_TONE: Record<AdminInvoiceDTO['status'], UiTone> = {
  DRAFT: 'muted',
  ISSUED: 'warn',
  PAID: 'success',
  OVERDUE: 'error',
  VOID: 'muted',
};

/** Every commission invoice on the platform, the daily job on demand, bank transfers and voids. */
export function AdminInvoices({ locale }: { locale: string }) {
  const t = useT(locale);
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState<AdminInvoicePageDTO | null>(null);
  const [report, setReport] = useState<BillingRunReportDTO | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const month = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

  const load = useCallback(async () => {
    const query = new URLSearchParams({ page: '1', pageSize: '50' });
    if (status) query.set('status', status);
    setPage(await bffJson<AdminInvoicePageDTO>(`admin/billing/invoices?${query.toString()}`));
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

  const runJob = () =>
    act(async () => {
      setReport(await bffJson<BillingRunReportDTO>('admin/billing/run', { method: 'POST', body: JSON.stringify({}) }));
    });
  const collect = (id: string) =>
    act(async () => {
      const result = await bffJson<PayInvoiceResultDTO>(`admin/billing/invoices/${id}/collect`, {
        method: 'POST',
        body: '{}',
      });
      setNotice(
        result.status === 'CAPTURED'
          ? t('admin.invoices.updated')
          : t('billing.pay.failed', { code: result.failureCode ?? result.status }),
      );
    });
  const markPaid = (id: string) =>
    act(async () => {
      await bffJson<AdminInvoiceDTO>(`admin/billing/invoices/${id}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify({ paymentRef: (refs[id] ?? '').trim() }),
      });
      setNotice(t('admin.invoices.updated'));
    });
  const voidInvoice = (id: string) =>
    act(async () => {
      await bffJson<AdminInvoiceDTO>(`admin/billing/invoices/${id}/void`, { method: 'POST', body: '{}' });
      setNotice(t('admin.invoices.updated'));
    });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('admin.invoices.title')}</h1>
        <p className="ui-text-muted">{t('admin.invoices.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {notice && <p className="pui-alert pui-success">{notice}</p>}

      <Card title={t('admin.invoices.run')}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <Button onClick={runJob} disabled={busy}>
            {t('admin.invoices.run')}
          </Button>
          <SelectField label={t('admin.invoices.filter')} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('admin.invoices.all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`billing.status.${s}`)}
              </option>
            ))}
          </SelectField>
        </div>
        {report && (
          <p role="status" className="ui-caption">
            {t('admin.invoices.report', {
              issued: report.issued,
              skipped: report.skipped,
              collected: report.collected,
              collectionFailed: report.collectionFailed,
              overdue: report.overdue,
              suspended: report.suspended,
            })}
          </p>
        )}
      </Card>

      <Card title={t('billing.invoices.title')}>
        {page && page.items.length === 0 && <p className="ui-text-muted">{t('admin.invoices.empty')}</p>}
        {page && page.items.length > 0 && (
          <ul className="flex flex-col gap-4">
            {page.items.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-col gap-2 ui-rule pt-3"
                aria-label={`${invoice.restaurant.name} ${month(invoice.periodStart)}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="ui-heading">
                    {invoice.restaurant.name}: {month(invoice.periodStart)}
                  </span>
                  <Badge tone={STATUS_TONE[invoice.status]}>{t(`billing.status.${invoice.status}`)}</Badge>
                </div>
                <p>
                  {t('billing.invoices.orders')}: {invoice.orderCount}. {t('billing.invoices.total')}:{' '}
                  {formatMoney({ amountMinor: invoice.totalMinor, currency: invoice.currency }, locale)}
                </p>
                <p className="ui-caption">
                  {invoice.dueAt && `${t('billing.invoices.due')}: ${day(invoice.dueAt)}. `}
                  {invoice.paidAt && `${t('billing.invoices.paidAt', { date: day(invoice.paidAt) })}. `}
                  {invoice.paymentRef && `${invoice.paymentRef}. `}
                  {invoice.fiscalRef && `${t('billing.invoices.fiscal')}: ${invoice.fiscalRef}. `}
                  {invoice.collectionAttempts > 0 &&
                    `${t('billing.invoices.attempts', { count: invoice.collectionAttempts })}. `}
                  {invoice.lastCollectionError &&
                    t('billing.invoices.lastError', { code: invoice.lastCollectionError })}
                </p>
                {(invoice.status === 'ISSUED' || invoice.status === 'OVERDUE') && (
                  <div className="flex flex-col gap-3 md:flex-row md:items-end">
                    <Button variant="outline" onClick={() => collect(invoice.id)} disabled={busy}>
                      {t('admin.invoices.collect')}
                    </Button>
                    <TextField
                      label={t('admin.invoices.paymentRef')}
                      value={refs[invoice.id] ?? ''}
                      onChange={(e) => setRefs((r) => ({ ...r, [invoice.id]: e.target.value }))}
                    />
                    <Button
                      variant="outline"
                      onClick={() => markPaid(invoice.id)}
                      disabled={busy || (refs[invoice.id] ?? '').trim().length < 2}
                    >
                      {t('admin.invoices.markPaid')}
                    </Button>
                    <Button variant="outline" tone="error" onClick={() => voidInvoice(invoice.id)} disabled={busy}>
                      {t('admin.invoices.void')}
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
