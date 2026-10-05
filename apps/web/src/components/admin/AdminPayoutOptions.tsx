'use client';

import { useCallback, useEffect, useState } from 'react';
import { PAYOUT_CADENCES } from '@resget/shared';
import type { PayoutCadence, PayoutScheduleOptionDTO } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

interface Draft {
  cadence: PayoutCadence;
  currency: string;
  feeBps: string;
  feeFixedMinor: string;
  settleBusinessDays: string;
  requiresFastPayouts: boolean;
  freeWithFastPayouts: boolean;
  isActive: boolean;
}

const EMPTY: Draft = {
  cadence: 'DAILY',
  currency: '',
  feeBps: '0',
  feeFixedMinor: '0',
  settleBusinessDays: '1',
  requiresFastPayouts: false,
  freeWithFastPayouts: false,
  isActive: true,
};

/** Payout schedule options (docs/HAKEDIS_TAKVIMI.md): the fee, delay and plan rule per schedule and currency are data. */
export function AdminPayoutOptions({ locale }: { locale: string }) {
  const t = useT(locale);
  const [options, setOptions] = useState<PayoutScheduleOptionDTO[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    bffJson<PayoutScheduleOptionDTO[]>('admin/payouts/options').then(setOptions).catch(fail);
  }, [fail]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await bffJson<PayoutScheduleOptionDTO[]>('admin/payouts/options', {
        method: 'PUT',
        body: JSON.stringify({
          cadence: draft.cadence,
          currency: draft.currency.trim().toUpperCase(),
          feeBps: Number(draft.feeBps),
          feeFixedMinor: Number(draft.feeFixedMinor),
          settleBusinessDays: Number(draft.settleBusinessDays),
          requiresFastPayouts: draft.requiresFastPayouts,
          freeWithFastPayouts: draft.freeWithFastPayouts,
          isActive: draft.isActive,
        }),
      });
      setOptions(next);
      setNotice(t('common.saved'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const check = (key: 'requiresFastPayouts' | 'freeWithFastPayouts' | 'isActive', label: string) => (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        className="pui-checkbox"
        checked={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <Card title={t('finance.options.title')} aria-label={t('finance.options.title')}>
      <p className="ui-text-muted">{t('finance.options.intro')}</p>
      {!options ? (
        <p className="ui-text-muted">{t('common.loading')}</p>
      ) : options.length === 0 ? (
        <p className="ui-text-muted">{t('finance.options.empty')}</p>
      ) : (
        <ul className="ui-divide">
          {options.map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
              data-payout-option-row={`${o.cadence}:${o.currency}`}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="ui-heading">{t(`finance.payouts.cadence.${o.cadence}`)}</span>
                <Badge>{o.currency}</Badge>
                <span className="ui-caption">
                  {o.feeBps} bps + {o.feeFixedMinor} / {o.settleBusinessDays}
                </span>
                {o.requiresFastPayouts && <Badge tone="warn">{t('finance.options.requiresFast')}</Badge>}
                {o.freeWithFastPayouts && <Badge tone="success">{t('finance.options.freeWithFast')}</Badge>}
                {!o.isActive && <Badge tone="muted">{t('payments.connection.status.DISABLED')}</Badge>}
              </span>
              <Button
                variant="link"
                tone="muted"
                onClick={() =>
                  setDraft({
                    cadence: o.cadence,
                    currency: o.currency,
                    feeBps: String(o.feeBps),
                    feeFixedMinor: String(o.feeFixedMinor),
                    settleBusinessDays: String(o.settleBusinessDays),
                    requiresFastPayouts: o.requiresFastPayouts,
                    freeWithFastPayouts: o.freeWithFastPayouts,
                    isActive: o.isActive,
                  })
                }
              >
                {t('common.edit')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-3 md:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <SelectField
          id="payout-option-cadence"
          label={t('finance.options.cadence')}
          value={draft.cadence}
          onChange={(e) => setDraft({ ...draft, cadence: e.target.value as PayoutCadence })}
        >
          {PAYOUT_CADENCES.map((c) => (
            <option key={c} value={c}>
              {t(`finance.payouts.cadence.${c}`)}
            </option>
          ))}
        </SelectField>
        <TextField
          id="payout-option-currency"
          label={t('finance.options.currency')}
          value={draft.currency}
          maxLength={3}
          onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
          required
        />
        <TextField
          id="payout-option-days"
          type="number"
          min={0}
          max={10}
          label={t('finance.options.settleDays')}
          value={draft.settleBusinessDays}
          onChange={(e) => setDraft({ ...draft, settleBusinessDays: e.target.value })}
        />
        <TextField
          id="payout-option-bps"
          type="number"
          min={0}
          max={1000}
          label={t('finance.options.feeBps')}
          value={draft.feeBps}
          onChange={(e) => setDraft({ ...draft, feeBps: e.target.value })}
        />
        <TextField
          id="payout-option-fixed"
          type="number"
          min={0}
          label={t('finance.options.feeFixed')}
          value={draft.feeFixedMinor}
          onChange={(e) => setDraft({ ...draft, feeFixedMinor: e.target.value })}
        />
        <div className="flex flex-col gap-2">
          {check('requiresFastPayouts', t('finance.options.requiresFast'))}
          {check('freeWithFastPayouts', t('finance.options.freeWithFast'))}
          {check('isActive', t('finance.options.active'))}
        </div>
        <div className="md:col-span-3">
          <Button type="submit" disabled={busy}>
            {t('finance.options.save')}
          </Button>
        </div>
      </form>
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
