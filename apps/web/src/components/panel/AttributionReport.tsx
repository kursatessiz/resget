'use client';

import { useCallback, useEffect, useState } from 'react';
import { ATTRIBUTION_GROUPS, ATTRIBUTION_MODELS, DIRECT_KEY, NONE_KEY, formatMoney } from '@resget/shared';
import type { AttributionGroup, AttributionModel, AttributionReportDTO, AttributionRowDTO } from '@resget/shared';
import { Card, SelectField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const RANGE_DAYS = [7, 30, 90, 365] as const;

/** Which sources, media and campaigns brought the tenant's conversions (docs/ATIF.md). */
export function AttributionReport({ restaurantId, locale }: { restaurantId: string; locale: string }) {
  const t = useT(locale);
  const [model, setModel] = useState<AttributionModel>('LAST_TOUCH');
  const [groupBy, setGroupBy] = useState<AttributionGroup>('source');
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<AttributionReportDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const query = new URLSearchParams({ model, groupBy, from: from.toISOString(), to: to.toISOString() });
    try {
      setReport(await bffJson<AttributionReportDTO>(`restaurants/${restaurantId}/attribution?${query.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    }
  }, [restaurantId, model, groupBy, days, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const keyLabel = (key: string) =>
    key === DIRECT_KEY ? t('attribution.key.direct') : key === NONE_KEY ? t('attribution.key.none') : key;
  const count = (value: number | undefined) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value ?? 0);
  const revenue = (row: AttributionRowDTO) =>
    row.revenue.length === 0
      ? '-'
      : row.revenue.map((r) => formatMoney({ amountMinor: r.minor, currency: r.currency }, locale)).join(', ');

  return (
    <Card title={t('attribution.report.title')} aria-label={t('attribution.report.title')}>
      <p className="ui-text-muted">{t('attribution.report.intro')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label={t('attribution.report.model')}
          value={model}
          onChange={(e) => setModel(e.target.value as AttributionModel)}
        >
          {ATTRIBUTION_MODELS.map((m) => (
            <option key={m} value={m}>
              {t(`attribution.model.${m}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('attribution.report.groupBy')}
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as AttributionGroup)}
        >
          {ATTRIBUTION_GROUPS.map((g) => (
            <option key={g} value={g}>
              {t(`attribution.group.${g}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('attribution.report.range')}
          value={String(days)}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {RANGE_DAYS.map((d) => (
            <option key={d} value={d}>
              {t('attribution.report.lastDays', { days: d })}
            </option>
          ))}
        </SelectField>
      </div>
      <p className="ui-caption">{t(`attribution.model.${model}.help`, { days: report?.windowDays ?? 30 })}</p>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {report && (
        <>
          <p className="ui-text-muted" data-visits={report.visits}>
            {t('attribution.report.visits', { visits: count(report.visits) })}
            {report.untaggedPaidVisits > 0 &&
              ` ${t('attribution.report.untagged', { visits: count(report.untaggedPaidVisits) })}`}
          </p>
          {report.rows.length === 0 ? (
            <p className="ui-text-muted">{t('attribution.report.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="pui-table w-full" aria-label={t('attribution.report.title')}>
                <thead>
                  <tr>
                    <th scope="col">{t(`attribution.group.${report.groupBy}`)}</th>
                    {report.types.map((type) => (
                      <th key={type} scope="col">
                        {t(`attribution.conversion.${type}`)}
                      </th>
                    ))}
                    <th scope="col">{t('attribution.report.revenue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.key} data-attribution-row={row.key}>
                      <th scope="row">{keyLabel(row.key)}</th>
                      {report.types.map((type) => (
                        <td key={type}>{count(row.conversions[type])}</td>
                      ))}
                      <td>{revenue(row)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{t('attribution.report.total')}</th>
                    {report.types.map((type) => (
                      <td key={type}>{count(report.totals.conversions[type])}</td>
                    ))}
                    <td>{revenue(report.totals)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
