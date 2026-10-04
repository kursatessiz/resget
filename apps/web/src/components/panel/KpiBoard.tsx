'use client';

import { useCallback, useEffect, useState } from 'react';
import { KPI_RANGE_DAYS, ORDER_CHANNEL_KEYS, formatMoney, funnelStepRates } from '@resget/shared';
import type { FunnelStepDTO, KpiRangeDays, PlatformKpiDTO } from '@resget/shared';
import { Badge, Card, SelectField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const CHART_HEIGHT = 120;
const BAR_WIDTH = 10;
const BAR_GAP = 2;

/**
 * The platform funnels and KPI board (docs/HUNILER.md): the defining KPI as a
 * hero number, a single-series daily bar chart, two funnels with the share of
 * the previous step, channels, money per currency and districts. Totals only.
 */
export function KpiBoard({ locale }: { locale: string }) {
  const t = useT(locale);
  const [days, setDays] = useState<KpiRangeDays>(30);
  const [data, setData] = useState<PlatformKpiDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const number = useCallback((n: number) => new Intl.NumberFormat(locale).format(n), [locale]);
  const decimal = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
  const percent = (bps: number) =>
    new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(bps / 10_000);
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso));

  useEffect(() => {
    setError(null);
    bffJson<PlatformKpiDTO>(`platform/kpi?days=${days}`)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')));
  }, [days, t]);

  const funnel = (title: string, steps: FunnelStepDTO[], note?: string) => {
    const rates = funnelStepRates(steps);
    const top = Math.max(1, ...steps.map((s) => s.count));
    return (
      <Card title={title} aria-label={title}>
        <ol className="flex flex-col gap-3">
          {steps.map((step, i) => (
            <li key={step.key} className="flex flex-col gap-1" data-step={step.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span>{t(`kpi.step.${step.key}`)}</span>
                <span className="ui-heading">{number(step.count)}</span>
              </div>
              <div className="funnel-track" aria-hidden="true">
                <div className="funnel-fill" style={{ width: `${(step.count / top) * 100}%` }} />
              </div>
              {rates[i] !== null && (
                <span className="ui-caption">{t('kpi.step.rate', { rate: percent(rates[i] ?? 0) })}</span>
              )}
            </li>
          ))}
        </ol>
        {note && <p className="ui-caption">{note}</p>}
      </Card>
    );
  };

  const peak = data ? Math.max(0, ...data.daily.map((d) => d.orders)) : 0;
  const width = data ? data.daily.length * (BAR_WIDTH + BAR_GAP) : 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="ui-title">{t('kpi.title')}</h1>
          <p className="ui-text-muted">{t('kpi.intro')}</p>
        </div>
        <SelectField
          label={t('kpi.range')}
          value={String(days)}
          onChange={(e) => setDays(Number(e.target.value) as KpiRangeDays)}
        >
          {KPI_RANGE_DAYS.map((d) => (
            <option key={d} value={d}>
              {t('kpi.range.days', { days: d })}
            </option>
          ))}
        </SelectField>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}

      {data && (
        <>
          <section className="grid gap-4 md:grid-cols-4" aria-label={t('kpi.title')}>
            <Card title={t('kpi.tile.perDay')}>
              <p className="ui-title" data-kpi="perDay">
                {decimal(data.orders.perRestaurantPerDay)}
              </p>
              <p className="ui-caption">{t('kpi.tile.perDayHelp')}</p>
            </Card>
            <Card title={t('kpi.tile.orders')}>
              <p className="ui-title" data-kpi="orders">
                {number(data.orders.total)}
              </p>
              <p className="ui-caption">
                {t('kpi.customers', {
                  first: number(data.orders.firstOrders),
                  repeat: number(data.orders.repeatOrders),
                })}
              </p>
            </Card>
            <Card title={t('kpi.tile.active')}>
              <p className="ui-title" data-kpi="active">
                {number(data.restaurants.active)}
              </p>
              <p className="ui-caption">
                {t('kpi.tile.total')}: {number(data.restaurants.total)}, {t('kpi.tile.trials')}:{' '}
                {number(data.restaurants.trials)}
              </p>
            </Card>
            <Card title={t('kpi.tile.listed')}>
              <p className="ui-title" data-kpi="listed">
                {number(data.restaurants.listed)}
              </p>
            </Card>
          </section>

          <Card title={t('kpi.daily.title')} aria-label={t('kpi.daily.title')}>
            <svg
              role="img"
              aria-label={t('kpi.daily.peak', { count: number(peak) })}
              viewBox={`0 0 ${Math.max(width, 1)} ${CHART_HEIGHT + 1}`}
              preserveAspectRatio="none"
              className="w-full"
              height={CHART_HEIGHT}
            >
              {data.daily.map((d, i) => {
                const h = peak > 0 ? Math.max(d.orders > 0 ? 2 : 0, (d.orders / peak) * CHART_HEIGHT) : 0;
                return (
                  <rect
                    key={d.date}
                    className="chart-bar"
                    x={i * (BAR_WIDTH + BAR_GAP)}
                    y={CHART_HEIGHT - h}
                    width={BAR_WIDTH}
                    height={h}
                    rx={2}
                    tabIndex={0}
                  >
                    <title>{t('kpi.daily.bar', { date: day(d.date), count: number(d.orders) })}</title>
                  </rect>
                );
              })}
              <line className="chart-axis" x1={0} x2={width} y1={CHART_HEIGHT + 0.5} y2={CHART_HEIGHT + 0.5} />
            </svg>
            <div className="flex justify-between">
              <span className="ui-caption">{data.daily[0] ? day(data.daily[0].date) : ''}</span>
              <span className="ui-caption">{t('kpi.daily.peak', { count: number(peak) })}</span>
              <span className="ui-caption">{data.daily.length ? day(data.daily[data.daily.length - 1].date) : ''}</span>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {funnel(t('kpi.funnel.tableQr'), data.funnels.tableQr)}
            {funnel(t('kpi.funnel.restaurants'), data.funnels.restaurants, t('kpi.funnel.cohortNote'))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title={t('kpi.channels.title')} aria-label={t('kpi.channels.title')}>
              <ul className="flex flex-col gap-2">
                {ORDER_CHANNEL_KEYS.map((channel) => (
                  <li key={channel} className="flex justify-between gap-2">
                    <span>{t(`segments.enum.firstChannel.${channel}`)}</span>
                    <span className="ui-heading">{number(data.orders.byChannel[channel])}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title={t('kpi.money.title')} aria-label={t('kpi.money.title')}>
              {data.money.length === 0 && <p className="ui-text-muted">{t('kpi.money.empty')}</p>}
              <ul className="flex flex-col gap-2">
                {data.money.map((m) => (
                  <li key={m.currency} className="flex flex-col gap-1" data-currency={m.currency}>
                    <span>
                      {t('kpi.money.gmv')}: {formatMoney({ amountMinor: m.gmvMinor, currency: m.currency }, locale)}
                    </span>
                    <span className="ui-caption">
                      {t('kpi.money.commission')}:{' '}
                      {formatMoney({ amountMinor: m.commissionMinor, currency: m.currency }, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card title={t('kpi.districts.title')} aria-label={t('kpi.districts.title')}>
            {data.districts.length === 0 ? (
              <p className="ui-text-muted">{t('kpi.districts.empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="pui-table w-full">
                  <thead>
                    <tr>
                      <th scope="col">{t('kpi.districts.district')}</th>
                      <th scope="col">{t('kpi.districts.restaurants')}</th>
                      <th scope="col">{t('kpi.districts.listed')}</th>
                      <th scope="col">{t('kpi.districts.orders')}</th>
                      <th scope="col">{t('kpi.districts.perDay')}</th>
                      <th scope="col">{t('kpi.districts.launched')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.districts.map((d) => (
                      <tr key={`${d.countryCode}-${d.city}-${d.district}`}>
                        <td>
                          {d.district}, {d.city}
                        </td>
                        <td>{number(d.restaurants)}</td>
                        <td>{number(d.listedRestaurants)}</td>
                        <td>{number(d.orders)}</td>
                        <td>{decimal(d.ordersPerRestaurantPerDay)}</td>
                        <td>
                          <Badge tone={d.isLaunched ? 'success' : 'muted'}>
                            {d.isLaunched ? t('kpi.yes') : t('kpi.no')}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
