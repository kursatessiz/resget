'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type { TipDTO, TipTotalsDTO, TipsReportDTO } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const PERIODS = [7, 30, 90] as const;

/**
 * Courier tips (docs/BAHSIS.md): what each own courier and each courier
 * network received in the period, with a retry for a failed hand-over and,
 * for staff allowed to refund, giving a collected tip back to the customer.
 */
export function CourierTipsPanel({
  restaurantId,
  locale,
  canRefund,
}: {
  restaurantId: string;
  locale: string;
  canRefund: boolean;
}) {
  const t = useT(locale);
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<TipsReportDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setReport(await bffJson<TipsReportDTO>(`restaurants/${restaurantId}/tips?days=${days}`));
  }, [restaurantId, days]);

  useEffect(() => {
    load().catch((err: unknown) =>
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    );
  }, [load, t]);

  const money = (amountMinor: number) =>
    report ? formatMoney({ amountMinor, currency: report.currency }, locale) : '';
  const count = (value: number) => new Intl.NumberFormat(locale).format(value);
  const cells = (row: TipTotalsDTO) => (
    <>
      <td>{count(row.count)}</td>
      <td>{money(row.grossMinor)}</td>
      <td>{money(row.feeMinor)}</td>
      <td>{money(row.netMinor)}</td>
    </>
  );

  const retry = async (tip: TipDTO) => {
    setBusy(tip.id);
    setError(null);
    setNotice(null);
    try {
      const next = await bffJson<TipDTO>(`restaurants/${restaurantId}/tips/${tip.id}/pass-through`, { method: 'POST' });
      if (next.passThroughStatus === 'SENT') setNotice(t('tips.report.retried'));
      else setError(t('tips.passThrough.FAILED'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(null);
    }
  };

  const refund = async (tip: TipDTO) => {
    setBusy(tip.id);
    setError(null);
    setNotice(null);
    try {
      await bffJson<TipDTO>(`restaurants/${restaurantId}/tips/${tip.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setNotice(t('tips.report.refunded'));
      setRefunding(null);
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(null);
    }
  };

  const heads = (
    <>
      <th scope="col">{t('tips.report.col.name')}</th>
      <th scope="col">{t('tips.report.col.count')}</th>
      <th scope="col">{t('tips.report.col.gross')}</th>
      <th scope="col">{t('tips.report.col.fee')}</th>
      <th scope="col">{t('tips.report.col.net')}</th>
    </>
  );

  return (
    <Card title={t('tips.report.title')} aria-label={t('tips.report.title')}>
      <div className="flex flex-col gap-4">
        <p className="ui-caption">{t('tips.report.intro')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <SelectField label={t('tips.report.period')} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((value) => (
              <option key={value} value={value}>
                {t('tips.report.lastDays', { count: value })}
              </option>
            ))}
          </SelectField>
        </div>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {report && report.totals.count === 0 && <p className="ui-text-muted">{t('tips.report.empty')}</p>}
        {report && report.totals.count > 0 && (
          <>
            <p data-tips-totals>
              {t('tips.report.totals', {
                count: report.totals.count,
                gross: money(report.totals.grossMinor),
                fee: money(report.totals.feeMinor),
                net: money(report.totals.netMinor),
              })}
            </p>
            {report.couriers.length > 0 && (
              <div className="overflow-x-auto">
                <table className="pui-table w-full" aria-label={t('tips.report.couriers')}>
                  <caption className="ui-heading">{t('tips.report.couriers')}</caption>
                  <thead>
                    <tr>{heads}</tr>
                  </thead>
                  <tbody>
                    {report.couriers.map((row) => (
                      <tr key={row.membershipId} data-tips-courier={row.membershipId}>
                        <th scope="row">{row.name}</th>
                        {cells(row)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {report.networks.length > 0 && (
              <div className="overflow-x-auto">
                <table className="pui-table w-full" aria-label={t('tips.report.networks')}>
                  <caption className="ui-heading">{t('tips.report.networks')}</caption>
                  <thead>
                    <tr>
                      {heads}
                      <th scope="col">{t('tips.report.col.failed')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.networks.map((row) => (
                      <tr key={row.providerCode} data-tips-network={row.providerCode}>
                        <th scope="row">{row.name}</th>
                        {cells(row)}
                        <td>{count(row.failedPassThrough)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {report && report.recent.length > 0 && (
          <section className="flex flex-col gap-2" aria-label={t('tips.report.recent')}>
            <h3 className="ui-heading">{t('tips.report.recent')}</h3>
            <ul className="ui-divide">
              {report.recent.map((tip) => (
                <li
                  key={tip.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2"
                  data-tip-row={tip.id}
                >
                  <span className="flex flex-col">
                    <span>{t('tips.report.order', { code: tip.orderShortCode })}</span>
                    <span className="ui-caption">{tip.recipient}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="ui-price">{money(tip.netMinor)}</span>
                    <Badge tone={tip.status === 'CAPTURED' ? 'success' : 'warn'}>
                      {t(`tips.status.${tip.status}`)}
                    </Badge>
                    {tip.passThroughStatus && (
                      <Badge tone={tip.passThroughStatus === 'SENT' ? 'success' : 'error'}>
                        {t(`tips.passThrough.${tip.passThroughStatus}`)}
                      </Badge>
                    )}
                    {tip.passThroughStatus === 'FAILED' && tip.status === 'CAPTURED' && (
                      <Button variant="outline" disabled={busy === tip.id} onClick={() => void retry(tip)}>
                        {t('tips.report.retry')}
                      </Button>
                    )}
                    {canRefund && tip.status === 'CAPTURED' && refunding !== tip.id && (
                      <Button
                        variant="outline"
                        tone="error"
                        disabled={busy === tip.id}
                        onClick={() => {
                          setRefunding(tip.id);
                          setReason('');
                        }}
                      >
                        {t('tips.report.refund')}
                      </Button>
                    )}
                  </span>
                  {tip.refundReason && (
                    <span className="ui-caption w-full">
                      {t('tips.report.refundedWith', { reason: tip.refundReason })}
                    </span>
                  )}
                  {refunding === tip.id && (
                    <div className="flex w-full flex-col gap-2" data-tip-refund={tip.id}>
                      <p className="ui-caption">{t('tips.report.refundWarning')}</p>
                      <TextField
                        id={`tip-refund-${tip.id}`}
                        label={t('tips.report.refundReason')}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        maxLength={300}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          tone="error"
                          disabled={busy === tip.id || reason.trim().length === 0}
                          onClick={() => void refund(tip)}
                        >
                          {t('tips.report.refundConfirm')}
                        </Button>
                        <Button
                          variant="outline"
                          tone="muted"
                          disabled={busy === tip.id}
                          onClick={() => setRefunding(null)}
                        >
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Card>
  );
}
