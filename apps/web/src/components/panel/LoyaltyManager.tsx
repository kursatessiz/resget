'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  LOYALTY_TIERS_MAX,
  LOYALTY_TIER_MULTIPLIER,
  formatMoney,
  majorAmountText,
  parseMajorAmount,
} from '@resget/shared';
import type { LoyaltyOverviewDTO, LoyaltyProgram, LoyaltyProgramDTO } from '@resget/shared';
import { Badge, Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

interface Draft {
  enabled: boolean;
  earnPoints: string;
  earnStep: string;
  redeemPoints: string;
  redeemValue: string;
  minOrder: string;
  maxDiscountPercent: string;
  welcomePoints: string;
  notifyEarned: boolean;
  tiers: { name: string; minSpend: string; multiplierPct: string }[];
}

function draftOf(program: LoyaltyProgramDTO): Draft {
  return {
    enabled: program.enabled,
    earnPoints: String(program.earnPoints),
    earnStep: majorAmountText(program.earnStepMinor, program.currency),
    redeemPoints: String(program.redeemPoints),
    redeemValue: majorAmountText(program.redeemValueMinor, program.currency),
    minOrder: majorAmountText(program.minOrderMinor, program.currency),
    maxDiscountPercent: String(program.maxDiscountBps / 100),
    welcomePoints: String(program.welcomePoints),
    notifyEarned: program.notifyEarned,
    tiers: program.tiers.map((tier) => ({
      name: tier.name,
      minSpend: majorAmountText(tier.minSpendMinor, program.currency),
      multiplierPct: String(tier.earnMultiplierPct),
    })),
  };
}

/** PRO loyalty program (docs/SADAKAT.md): the rules, the counters and the latest point movements. */
export function LoyaltyManager({
  restaurantId,
  locale,
  canManage,
  isPro,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
  isPro: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/loyalty`;
  const [data, setData] = useState<LoyaltyOverviewDTO | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const money = (minor: number, currency: string) => formatMoney({ amountMinor: minor, currency }, locale);
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);

  const load = useCallback(async () => {
    const overview = await bffJson<LoyaltyOverviewDTO>(base);
    setData(overview);
    setDraft(draftOf(overview.program));
  }, [base]);

  useEffect(() => {
    load().catch(fail);
  }, [load, fail]);

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = async () => {
    if (!data || !draft) return;
    const currency = data.program.currency;
    const earnStepMinor = parseMajorAmount(draft.earnStep, currency);
    const redeemValueMinor = parseMajorAmount(draft.redeemValue, currency);
    const minOrderMinor = parseMajorAmount(draft.minOrder, currency);
    const percent = Number(draft.maxDiscountPercent);
    const tiers = draft.tiers.map((tier) => ({
      name: tier.name.trim(),
      minSpendMinor: parseMajorAmount(tier.minSpend, currency),
      earnMultiplierPct: Number(tier.multiplierPct),
    }));
    const tiersValid = tiers.every(
      (tier, i) =>
        tier.name.length > 0 &&
        tier.minSpendMinor !== null &&
        tier.minSpendMinor > 0 &&
        Number.isInteger(tier.earnMultiplierPct) &&
        (i === 0 || (tier.minSpendMinor ?? 0) > (tiers[i - 1]!.minSpendMinor ?? 0)),
    );
    if (
      earnStepMinor === null ||
      redeemValueMinor === null ||
      minOrderMinor === null ||
      !Number.isFinite(percent) ||
      !tiersValid
    ) {
      setError(t('errors.VALIDATION'));
      return;
    }
    const body: LoyaltyProgram = {
      enabled: draft.enabled,
      earnPoints: Number(draft.earnPoints),
      earnStepMinor,
      redeemPoints: Number(draft.redeemPoints),
      redeemValueMinor,
      minOrderMinor,
      maxDiscountBps: Math.round(percent * 100),
      welcomePoints: Number(draft.welcomePoints),
      notifyEarned: draft.notifyEarned,
      tiers: tiers.map((tier) => ({ ...tier, minSpendMinor: tier.minSpendMinor ?? 0 })),
    };
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await bffJson<LoyaltyProgramDTO>(base, { method: 'PUT', body: JSON.stringify(body) });
      await load();
      setNotice(t('loyalty.program.saved'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const program = data?.program ?? null;
  const status = !program
    ? null
    : program.active
      ? { tone: 'success' as const, text: t('loyalty.active') }
      : program.enabled
        ? { tone: 'warn' as const, text: t('loyalty.planLapsed') }
        : { tone: 'muted' as const, text: t('loyalty.inactive') };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('loyalty.title')}</h1>
        <p className="ui-text-muted">{t('loyalty.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="pui-alert pui-success">
          {notice}
        </p>
      )}
      {!isPro && <p className="pui-alert pui-warning">{t('loyalty.proRequired')}</p>}

      {program && draft && (
        <Card title={t('loyalty.program.title')} aside={status && <Badge tone={status.tone}>{status.text}</Badge>}>
          <p className="ui-caption">
            {t('loyalty.program.earn', {
              step: money(program.earnStepMinor, program.currency),
              points: number(program.earnPoints),
            })}
            .{' '}
            {t('loyalty.program.redeem', {
              points: number(program.redeemPoints),
              value: money(program.redeemValueMinor, program.currency),
            })}
            .
          </p>
          <form
            className="flex flex-col gap-4"
            aria-label={t('loyalty.program.title')}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="pui-checkbox"
                checked={draft.enabled}
                disabled={!canManage || !isPro}
                onChange={(e) => set({ enabled: e.target.checked })}
              />
              <span>{t('loyalty.program.enabled')}</span>
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                label={t('loyalty.program.earnPoints')}
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                value={draft.earnPoints}
                disabled={!canManage || !isPro}
                onChange={(e) => set({ earnPoints: e.target.value })}
              />
              <TextField
                label={t('loyalty.program.earnStep')}
                inputMode="decimal"
                value={draft.earnStep}
                disabled={!canManage || !isPro}
                onChange={(e) => set({ earnStep: e.target.value })}
              />
              <TextField
                label={t('loyalty.program.redeemPoints')}
                type="number"
                inputMode="numeric"
                min={1}
                value={draft.redeemPoints}
                disabled={!canManage || !isPro}
                onChange={(e) => set({ redeemPoints: e.target.value })}
              />
              <TextField
                label={t('loyalty.program.redeemValue')}
                inputMode="decimal"
                value={draft.redeemValue}
                disabled={!canManage || !isPro}
                onChange={(e) => set({ redeemValue: e.target.value })}
              />
              <TextField
                label={t('loyalty.program.minOrder')}
                inputMode="decimal"
                value={draft.minOrder}
                disabled={!canManage || !isPro}
                onChange={(e) => set({ minOrder: e.target.value })}
              />
              <TextField
                label={t('loyalty.program.maxDiscount')}
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                value={draft.maxDiscountPercent}
                disabled={!canManage || !isPro}
                onChange={(e) => set({ maxDiscountPercent: e.target.value })}
              />
              <TextField
                label={t('loyalty.program.welcomePoints')}
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.welcomePoints}
                disabled={!canManage || !isPro}
                onChange={(e) => set({ welcomePoints: e.target.value })}
              />
            </div>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="pui-checkbox mt-1"
                checked={draft.notifyEarned}
                disabled={!canManage || !isPro}
                onChange={(e) => set({ notifyEarned: e.target.checked })}
              />
              <span>{t('loyalty.program.notifyEarned')}</span>
            </label>
            <fieldset className="flex flex-col gap-3" data-loyalty-tiers>
              <legend className="ui-heading">{t('loyalty.tiers.title')}</legend>
              <p className="ui-caption">{t('loyalty.tiers.help')}</p>
              {draft.tiers.map((tier, i) => (
                <div key={i} className="grid items-end gap-3 md:grid-cols-4" data-loyalty-tier={i}>
                  <TextField
                    label={t('loyalty.tiers.name')}
                    value={tier.name}
                    maxLength={30}
                    disabled={!canManage || !isPro}
                    onChange={(e) =>
                      set({ tiers: draft.tiers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })
                    }
                  />
                  <TextField
                    label={t('loyalty.tiers.minSpend', { currency: data?.program.currency ?? '' })}
                    inputMode="decimal"
                    value={tier.minSpend}
                    disabled={!canManage || !isPro}
                    onChange={(e) =>
                      set({ tiers: draft.tiers.map((x, j) => (j === i ? { ...x, minSpend: e.target.value } : x)) })
                    }
                  />
                  <TextField
                    label={t('loyalty.tiers.multiplier')}
                    type="number"
                    inputMode="numeric"
                    min={LOYALTY_TIER_MULTIPLIER.min}
                    max={LOYALTY_TIER_MULTIPLIER.max}
                    value={tier.multiplierPct}
                    disabled={!canManage || !isPro}
                    onChange={(e) =>
                      set({
                        tiers: draft.tiers.map((x, j) => (j === i ? { ...x, multiplierPct: e.target.value } : x)),
                      })
                    }
                  />
                  {canManage && (
                    <Button
                      type="button"
                      variant="outline"
                      tone="muted"
                      disabled={!isPro}
                      onClick={() => set({ tiers: draft.tiers.filter((_, j) => j !== i) })}
                    >
                      {t('loyalty.tiers.remove')}
                    </Button>
                  )}
                </div>
              ))}
              {canManage && draft.tiers.length < LOYALTY_TIERS_MAX && (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!isPro}
                    onClick={() => set({ tiers: [...draft.tiers, { name: '', minSpend: '', multiplierPct: '150' }] })}
                  >
                    {t('loyalty.tiers.add')}
                  </Button>
                </div>
              )}
            </fieldset>
            {canManage && (
              <div>
                <Button type="submit" disabled={busy || !isPro}>
                  {t('loyalty.program.save')}
                </Button>
              </div>
            )}
          </form>
        </Card>
      )}

      {data && (
        <div className="grid gap-4 md:grid-cols-5">
          <Card title={t('loyalty.stats.members')}>
            <p className="ui-price">{number(data.stats.members)}</p>
          </Card>
          <Card title={t('loyalty.stats.outstanding')}>
            <p className="ui-price">{number(data.stats.pointsOutstanding)}</p>
          </Card>
          <Card title={t('loyalty.stats.earned')}>
            <p className="ui-price">{number(data.stats.pointsEarned)}</p>
          </Card>
          <Card title={t('loyalty.stats.redeemed')}>
            <p className="ui-price">{number(data.stats.pointsRedeemed)}</p>
          </Card>
          <Card title={t('loyalty.stats.discount')}>
            <p className="ui-price">{money(data.stats.discountGivenMinor, data.stats.currency)}</p>
          </Card>
        </div>
      )}

      {data && (
        <Card title={t('loyalty.recent.title')}>
          {data.recent.length === 0 && <p className="ui-text-muted">{t('loyalty.recent.empty')}</p>}
          {data.recent.length > 0 && (
            <ul className="ui-divide">
              {data.recent.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={row.points >= 0 ? 'success' : 'muted'}>{t(`loyalty.type.${row.type}`)}</Badge>
                    <span>{row.customer?.fullName}</span>
                    <span className="ui-caption">
                      {row.orderShortCode ? `${t('loyalty.order', { code: row.orderShortCode })}. ` : ''}
                      {row.memo && row.type === 'ADJUSTMENT' ? `${row.memo}. ` : ''}
                      {when(row.createdAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className={row.points >= 0 ? 'ui-heading' : 'ui-text-muted'}>
                      {t('loyalty.points', { points: number(row.points) })}
                    </span>
                    <span className="ui-caption">
                      {t('loyalty.balanceAfter', { points: number(row.balanceAfter) })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
