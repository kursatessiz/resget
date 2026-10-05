'use client';

import { useCallback, useEffect, useState } from 'react';
import { SCHEDULED_CADENCES, formatMoney } from '@resget/shared';
import type {
  InstantPayoutQuoteDTO,
  PayoutDTO,
  PayoutScheduleDTO,
  RestaurantPayoutOptionDTO,
  ScheduledCadence,
} from '@resget/shared';
import { Badge, Button, Card, SelectField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * Payout schedule (docs/HAKEDIS_TAKVIMI.md): weekly or daily, and an instant
 * payout of the waiting balance, with the fee the restaurant's plan pays.
 * Shown only to a restaurant the platform collects for.
 */
export function PayoutSchedulePanel({
  restaurantId,
  locale,
  canManage,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/finance`;
  const [data, setData] = useState<PayoutScheduleDTO | null>(null);
  const [quote, setQuote] = useState<InstantPayoutQuoteDTO | null>(null);
  const [cadence, setCadence] = useState<ScheduledCadence>('WEEKLY');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  const load = useCallback(async () => {
    const schedule = await bffJson<PayoutScheduleDTO>(`${base}/payout-schedule`);
    setData(schedule);
    setCadence(schedule.cadence);
    const instant = schedule.options.find((o) => o.cadence === 'INSTANT');
    if (instant && !instant.needsPlan && schedule.pendingPayableMinor > 0) {
      setQuote(await bffJson<InstantPayoutQuoteDTO>(`${base}/payouts/instant/quote`).catch(() => null));
    } else {
      setQuote(null);
    }
  }, [base]);

  useEffect(() => {
    load().catch(() => setData(null));
  }, [load]);

  if (!data || !data.platformCollects) return null;

  const money = (minor: number) => formatMoney({ amountMinor: minor, currency: data.currency }, locale);
  const option = (c: string) => data.options.find((o) => o.cadence === c) ?? null;
  const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

  const describe = (o: RestaurantPayoutOptionDTO) => {
    const fee = o.free
      ? t('finance.schedule.freeOnPlan')
      : o.feeBps === 0 && o.feeFixedMinor === 0
        ? t('finance.schedule.feeFree')
        : t('finance.schedule.fee', { percent: percent.format(o.feeBps / 100), fixed: money(o.feeFixedMinor) });
    const days =
      o.settleBusinessDays === 0
        ? t('finance.schedule.sameDay')
        : t('finance.schedule.days', { count: o.settleBusinessDays });
    return `${days}, ${fee}`;
  };

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await bffJson<PayoutScheduleDTO>(`${base}/payout-schedule`, { method: 'PUT', body: JSON.stringify({ cadence }) });
      return t('finance.schedule.saved');
    });

  const payNow = () =>
    run(async () => {
      const payout = await bffJson<PayoutDTO>(`${base}/payouts/instant`, { method: 'POST' });
      return t('finance.schedule.instant.done', { amount: money(payout.amountMinor) });
    });

  const instant = option('INSTANT');

  return (
    <Card title={t('finance.schedule.title')} aria-label={t('finance.schedule.title')}>
      <p className="ui-text-muted">{t('finance.schedule.intro')}</p>
      <p data-payout-cadence={data.cadence}>
        {t('finance.schedule.current', { cadence: t(`finance.payouts.cadence.${data.cadence}`) })}
      </p>
      <ul className="ui-divide">
        {SCHEDULED_CADENCES.map((c) => {
          const o = option(c);
          return (
            <li key={c} className="flex flex-wrap items-center justify-between gap-2 py-2" data-payout-option={c}>
              <span className="ui-heading">{t(`finance.payouts.cadence.${c}`)}</span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="ui-caption">
                  {o ? describe(o) : c === 'WEEKLY' ? t('finance.schedule.weeklyDefault') : ''}
                </span>
                {o?.needsPlan && <Badge tone="warn">{t('finance.schedule.needsPlan')}</Badge>}
              </span>
            </li>
          );
        })}
      </ul>
      {canManage && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <SelectField
            id="payout-cadence"
            label={t('finance.schedule.choose')}
            value={cadence}
            onChange={(e) => setCadence(e.target.value as ScheduledCadence)}
          >
            <option value="WEEKLY">{t('finance.payouts.cadence.WEEKLY')}</option>
            {option('DAILY') && !option('DAILY')?.needsPlan && (
              <option value="DAILY">{t('finance.payouts.cadence.DAILY')}</option>
            )}
          </SelectField>
          <Button type="submit" disabled={busy || cadence === data.cadence}>
            {t('finance.schedule.save')}
          </Button>
        </form>
      )}
      {instant && (
        <div className="ui-rule flex flex-col gap-2 pt-3" data-instant-payout>
          <span className="ui-heading">{t('finance.schedule.instant.title')}</span>
          <span className="ui-caption">{describe(instant)}</span>
          {instant.needsPlan ? (
            <Badge tone="warn">{t('finance.schedule.needsPlan')}</Badge>
          ) : quote && quote.netMinor > 0 ? (
            <>
              <p data-instant-quote>
                {t('finance.schedule.instant.quote', {
                  amount: money(quote.amountMinor),
                  fee: money(quote.feeMinor),
                  net: money(quote.netMinor),
                })}
              </p>
              {canManage && (
                <div>
                  <Button onClick={() => void payNow()} disabled={busy}>
                    {t('finance.schedule.instant.request')}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="ui-text-muted">{t('finance.schedule.instant.none')}</p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="ui-caption">
          {notice}
        </p>
      )}
    </Card>
  );
}
