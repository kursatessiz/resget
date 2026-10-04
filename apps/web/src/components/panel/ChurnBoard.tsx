'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CHURN_RISKS, CHURN_WATCH_RISKS, formatMoney } from '@resget/shared';
import type { ChurnCustomerDTO, ChurnOverviewDTO, ChurnRisk, ChurnWatchRisk } from '@resget/shared';
import { Badge, Button, Card } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const RISK_TONE: Record<ChurnRisk, UiTone> = {
  NEW: 'muted',
  ACTIVE: 'success',
  NOT_RETURNED: 'warn',
  AT_RISK: 'error',
  LOST: 'muted',
};

/**
 * Churn classes (docs/KAYIP_RISKI.md): how many customers sit in each class
 * and, per class to win back, the most valuable customers first with their
 * own rhythm, so the restaurant knows whom to reach before they are lost.
 */
export function ChurnBoard({
  restaurantId,
  locale,
  segmentsHref,
}: {
  restaurantId: string;
  locale: string;
  /** The segments screen when the viewer can build an audience from a class there. */
  segmentsHref: string | null;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/churn`;
  const [overview, setOverview] = useState<ChurnOverviewDTO | null>(null);
  const [risk, setRisk] = useState<ChurnWatchRisk>('AT_RISK');
  const [rows, setRows] = useState<ChurnCustomerDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  useEffect(() => {
    bffJson<ChurnOverviewDTO>(`${base}/overview`).then(setOverview).catch(fail);
  }, [base, fail]);
  useEffect(() => {
    // The overview sweeps the classes first; the list follows once they are current.
    if (!overview) return;
    setRows(null);
    bffJson<ChurnCustomerDTO[]>(`${base}/customers?risk=${risk}`).then(setRows).catch(fail);
  }, [base, risk, overview, fail]);

  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  const money = (amountMinor: number, currency: string) => formatMoney({ amountMinor, currency }, locale);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      <Card title={t('churn.title')} aria-label={t('churn.title')}>
        <p className="ui-text-muted">{t('churn.intro')}</p>
        {overview && (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5" data-churn-counts>
            {CHURN_RISKS.map((r) => (
              <div key={r} className="flex flex-col gap-1" data-churn-count={r}>
                <Badge tone={RISK_TONE[r]}>{t(`churn.risk.${r}`)}</Badge>
                <span className="ui-heading">{overview.counts[r]}</span>
                <span className="ui-caption">{t(`churn.riskHint.${r}`)}</span>
              </div>
            ))}
          </div>
        )}
        {overview && overview.counts.AT_RISK > 0 && (
          <p data-churn-value>
            {t('churn.atRiskValue', { amount: money(overview.atRiskLifetimeGrossMinor, overview.currency) })}
          </p>
        )}
        {segmentsHref && (
          <p className="ui-caption">
            {t('churn.segmentsHint')}{' '}
            <Link href={segmentsHref} className="pui-btn pui-link pui-theme">
              {t('churn.segmentsLink')}
            </Link>
          </p>
        )}
      </Card>

      <Card
        title={t('churn.list.title')}
        aria-label={t('churn.list.title')}
        aside={
          <div className="flex flex-wrap gap-2">
            {CHURN_WATCH_RISKS.map((r) => (
              <Button key={r} variant={risk === r ? 'solid' : 'outline'} tone="muted" onClick={() => setRisk(r)}>
                {t(`churn.risk.${r}`)}
              </Button>
            ))}
          </div>
        }
      >
        {rows && rows.length === 0 && <p className="ui-text-muted">{t('churn.list.empty')}</p>}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="pui-table w-full">
              <thead>
                <tr>
                  <th scope="col">{t('churn.list.customer')}</th>
                  <th scope="col">{t('churn.list.orders')}</th>
                  <th scope="col">{t('churn.list.lastOrder')}</th>
                  <th scope="col">{t('churn.list.rhythm')}</th>
                  <th scope="col">{t('churn.list.spend')}</th>
                  <th scope="col">{t('churn.list.consent')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-churn-row={row.id}>
                    <td>
                      {row.fullName || t('churn.list.unnamed')}
                      {row.phone && <span className="ui-caption"> {row.phone}</span>}
                    </td>
                    <td>{row.orderCount}</td>
                    <td>
                      {date(row.lastOrderAt)}
                      <span className="ui-caption"> {t('churn.list.daysAgo', { count: row.daysSinceLastOrder })}</span>
                    </td>
                    <td>
                      {row.usualIntervalDays === null
                        ? t('churn.list.singleOrder')
                        : t('churn.list.everyDays', { count: row.usualIntervalDays })}
                    </td>
                    <td>{money(row.lifetimeGrossMinor, row.currency)}</td>
                    <td>{row.marketingOptIn ? t('churn.list.optedIn') : t('churn.list.noConsent')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
