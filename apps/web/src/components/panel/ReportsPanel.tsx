'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type { ReportSummaryDTO } from '@resget/shared';
import { Card, LinkButton, SelectField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const BASIC_RANGES = [7, 30] as const;
const PRO_RANGES = [7, 30, 90, 365] as const;

/** Reports: completed orders, revenue, average basket, commission, breakdowns and best sellers (docs/PANEL.md). */
export function ReportsPanel({
  restaurantId,
  locale,
  isPro,
}: {
  restaurantId: string;
  locale: string;
  isPro: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/reports`;
  const ranges = isPro ? PRO_RANGES : BASIC_RANGES;
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<ReportSummaryDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const money = (amountMinor: number) => (data ? formatMoney({ amountMinor, currency: data.currency }, locale) : '');
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso));

  useEffect(() => {
    bffJson<ReportSummaryDTO>(`${base}/summary?days=${days}`).then(setData).catch(fail);
  }, [base, days, fail]);

  const maxDaily = data ? Math.max(1, ...data.daily.map((d) => d.grossMinor)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('reports.title')}</h1>
        <p className="ui-text-muted">{t('reports.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <SelectField label={t('reports.range')} value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          {ranges.map((r) => (
            <option key={r} value={r}>
              {t('reports.range.days', { days: r })}
            </option>
          ))}
        </SelectField>
        {isPro ? (
          <LinkButton href={`/api/bff/${base}/orders.csv?days=${days}`} variant="outline" tone="muted">
            {t('reports.export')}
          </LinkButton>
        ) : (
          <span className="ui-caption">{t('reports.proRange')}</span>
        )}
      </div>

      {data && (
        <>
          <div className="grid gap-3 md:grid-cols-5">
            <Card title={t('reports.kpi.completed')}>
              <p className="ui-title">{data.completedOrders}</p>
            </Card>
            <Card title={t('reports.kpi.cancelled')}>
              <p className="ui-title">{data.cancelledOrders}</p>
            </Card>
            <Card title={t('reports.kpi.gross')}>
              <p className="ui-title">{money(data.grossMinor)}</p>
            </Card>
            <Card title={t('reports.kpi.average')}>
              <p className="ui-title">{money(data.averageBasketMinor)}</p>
            </Card>
            <Card title={t('reports.kpi.commission')}>
              <p className="ui-title">{money(data.commissionMinor)}</p>
            </Card>
          </div>

          <Card title={t('reports.daily')}>
            {data.completedOrders === 0 && <p className="ui-text-muted">{t('reports.empty')}</p>}
            {data.completedOrders > 0 && (
              <ul className="flex flex-col gap-1" aria-label={t('reports.daily')}>
                {data.daily.map((d) => (
                  <li key={d.date} className="grid grid-cols-[6rem_1fr_8rem] items-center gap-2">
                    <span className="ui-caption">{day(d.date)}</span>
                    <progress className="w-full" value={d.grossMinor} max={maxDaily} aria-label={day(d.date)} />
                    <span className="ui-caption text-right">
                      {t('reports.orders', { count: d.orders })}, {money(d.grossMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid gap-3 md:grid-cols-3">
            <Card title={t('reports.byFulfillment')}>
              <ul className="flex flex-col gap-1">
                {data.byFulfillment.map((b) => (
                  <li key={b.key} className="flex justify-between gap-2">
                    <span>{t(`orders.fulfillment.${b.key}`)}</span>
                    <span className="ui-caption">
                      {t('reports.orders', { count: b.orders })}, {money(b.grossMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title={t('reports.byChannel')}>
              <ul className="flex flex-col gap-1">
                {data.byChannel.map((b) => (
                  <li key={b.key} className="flex justify-between gap-2">
                    <span>{t(`orders.channel.${b.key}`)}</span>
                    <span className="ui-caption">
                      {t('reports.orders', { count: b.orders })}, {money(b.grossMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title={t('reports.topItems')}>
              <ol className="flex flex-col gap-1">
                {data.topItems.map((item) => (
                  <li key={item.name} className="flex justify-between gap-2">
                    <span>{item.name}</span>
                    <span className="ui-caption">
                      {t('reports.quantity', { count: item.quantity })}, {money(item.grossMinor)}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
