'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type { FinanceLedgerDTO, PayoutDTO } from '@resget/shared';
import { Badge, Card } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const STATUS_TONE: Record<PayoutDTO['status'], UiTone> = {
  SCHEDULED: 'warn',
  SENT: 'warn',
  SETTLED: 'success',
  FAILED: 'error',
};

/** Ledger lines and weekly payouts of a restaurant the platform collects for (docs/MUTABAKAT.md). */
export function LedgerPanel({ restaurantId, locale }: { restaurantId: string; locale: string }) {
  const t = useT(locale);
  const [data, setData] = useState<FinanceLedgerDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  useEffect(() => {
    bffJson<FinanceLedgerDTO>(`restaurants/${restaurantId}/finance/ledger`).then(setData).catch(fail);
  }, [restaurantId, fail]);

  const day = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  const money = (amountMinor: number, currency: string) => formatMoney({ amountMinor, currency }, locale);
  if (error) {
    return (
      <p role="alert" className="pui-alert pui-error">
        {error}
      </p>
    );
  }
  if (!data) return null;
  if (data.paymentMode === 'OWN_POS' && data.entries.length === 0 && data.payouts.length === 0) {
    return (
      <Card title={t('finance.ledger.title')}>
        <p className="ui-text-muted">{t('finance.ledger.ownPos')}</p>
      </Card>
    );
  }
  return (
    <>
      <Card title={t('finance.ledger.title')}>
        <p className="ui-text-muted">{t('finance.ledger.intro')}</p>
        <p className="ui-heading">
          {t('finance.ledger.pending', { amount: money(data.pendingPayableMinor, data.currency) })}
        </p>
        <p className="ui-caption">{t('finance.ledger.pendingHelp')}</p>
      </Card>
      <Card title={t('finance.payouts.title')}>
        {data.payouts.length === 0 && <p className="ui-text-muted">{t('finance.payouts.empty')}</p>}
        {data.payouts.length > 0 && (
          <ul className="flex flex-col gap-2">
            {data.payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 ui-rule pt-2">
                <span className="flex flex-col">
                  <span className="ui-heading">{money(p.amountMinor, p.currency)}</span>
                  <span className="ui-caption">
                    {t('finance.payouts.period', { start: day(p.periodStart), end: day(p.periodEnd) })}.{' '}
                    {t('finance.payouts.entries', { count: p.entryCount })}.{' '}
                    {p.cadence !== 'WEEKLY' && `${t(`finance.payouts.cadence.${p.cadence}`)}. `}
                    {p.feeMinor > 0 && `${t('finance.payouts.fee', { amount: money(p.feeMinor, p.currency) })}. `}
                    {p.settledAt
                      ? t('finance.payouts.settledAt', { date: day(p.settledAt) })
                      : p.sentAt
                        ? t('finance.payouts.sentAt', { date: day(p.sentAt) })
                        : p.failureReason
                          ? t('finance.payouts.failed', { reason: p.failureReason })
                          : t('finance.payouts.scheduledFor', { date: day(p.scheduledFor) })}
                  </span>
                </span>
                <Badge tone={STATUS_TONE[p.status]}>{t(`finance.payouts.status.${p.status}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('finance.entries.title')}>
        {data.entries.length === 0 && <p className="ui-text-muted">{t('finance.entries.empty')}</p>}
        {data.entries.length > 0 && (
          <ul className="flex flex-col gap-1">
            {data.entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2">
                <span className="ui-caption">
                  {day(e.occurredAt)}. {t(`settlement.line.${e.type}`)}
                  {e.orderShortCode ? `, ${t('finance.entries.order', { code: e.orderShortCode })}` : ''}
                </span>
                <span className={e.amountMinor < 0 ? 'ui-text-muted' : undefined}>
                  {money(e.amountMinor, e.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
