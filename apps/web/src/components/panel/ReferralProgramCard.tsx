'use client';

import { useCallback, useEffect, useState } from 'react';
import { UpsertReferralProgramSchema, formatMoney, majorAmountText, parseMajorAmount } from '@resget/shared';
import type { CouponKind, ReferralProgramDTO } from '@resget/shared';
import { Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

interface Draft {
  isActive: boolean;
  friendKind: CouponKind;
  percent: string;
  maxDiscount: string;
  amount: string;
  minBasket: string;
  reward: string;
  validDays: string;
  cap: string;
}

/**
 * The customer referral programme (docs/TAVSIYE.md) on the coupons page:
 * the friend's first-order discount, the referrer's reward, limits and the
 * results so far. Amounts are typed in major units of the restaurant's currency.
 */
export function ReferralProgramCard({
  restaurantId,
  currency,
  locale,
  canManage,
  isPro,
}: {
  restaurantId: string;
  currency: string;
  locale: string;
  canManage: boolean;
  isPro: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/referrals/program`;
  const [program, setProgram] = useState<ReferralProgramDTO | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const money = (minor: number) => formatMoney({ amountMinor: minor, currency }, locale);
  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const toDraft = useCallback(
    (p: ReferralProgramDTO | null): Draft => ({
      isActive: p?.isActive ?? false,
      friendKind: p?.friendKind ?? 'PERCENT',
      percent: String((p?.friendPercentBps ?? 1000) / 100),
      maxDiscount: p?.friendMaxDiscountMinor ? majorAmountText(p.friendMaxDiscountMinor, currency) : '',
      amount: p?.friendAmountMinor ? majorAmountText(p.friendAmountMinor, currency) : '',
      minBasket: majorAmountText(p?.friendMinBasketMinor ?? 0, currency),
      reward: p ? majorAmountText(p.rewardAmountMinor, currency) : '',
      validDays: String(p?.rewardValidDays ?? 90),
      cap: String(p?.monthlyCapPerReferrer ?? 10),
    }),
    [currency],
  );

  useEffect(() => {
    bffJson<{ program: ReferralProgramDTO | null }>(base)
      .then((res) => {
        setProgram(res.program);
        setDraft(toDraft(res.program));
      })
      .catch(fail);
  }, [base, fail, toDraft]);

  if (!draft) return error ? <p role="alert">{error}</p> : null;
  const patch = (fields: Partial<Draft>) => setDraft({ ...draft, ...fields });

  const save = async () => {
    setError(null);
    setNotice(null);
    const rules = {
      isActive: draft.isActive,
      friendMinBasketMinor: parseMajorAmount(draft.minBasket || '0', currency) ?? -1,
      rewardAmountMinor: parseMajorAmount(draft.reward, currency) ?? 0,
      rewardValidDays: Number(draft.validDays),
      monthlyCapPerReferrer: Number(draft.cap),
    };
    const parsed = UpsertReferralProgramSchema.safeParse(
      draft.friendKind === 'PERCENT'
        ? {
            ...rules,
            friendKind: 'PERCENT',
            friendPercentBps: Math.round(Number(draft.percent) * 100),
            friendMaxDiscountMinor: draft.maxDiscount.trim()
              ? (parseMajorAmount(draft.maxDiscount, currency) ?? 0)
              : null,
          }
        : { ...rules, friendKind: 'AMOUNT', friendAmountMinor: parseMajorAmount(draft.amount, currency) ?? 0 },
    );
    if (!parsed.success) {
      setError(t('referrals.program.invalid'));
      return;
    }
    setBusy(true);
    try {
      const saved = await bffJson<ReferralProgramDTO>(base, { method: 'PUT', body: JSON.stringify(parsed.data) });
      setProgram(saved);
      setDraft(toDraft(saved));
      setNotice(t('referrals.program.saved'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const editable = canManage && isPro;
  return (
    <Card title={t('referrals.program.title')} aria-label={t('referrals.program.title')}>
      <p className="ui-text-muted">{t('referrals.program.intro')}</p>
      {!isPro && <p className="pui-alert pui-warning">{t('referrals.program.notPro')}</p>}
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
      <fieldset className="flex flex-col gap-3" disabled={!editable || busy}>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="pui-checkbox"
            checked={draft.isActive}
            onChange={(e) => patch({ isActive: e.target.checked })}
          />
          <span>{t('referrals.program.active')}</span>
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField
            label={t('referrals.program.friendKind')}
            value={draft.friendKind}
            onChange={(e) => patch({ friendKind: e.target.value as CouponKind })}
          >
            <option value="PERCENT">{t('referrals.kind.PERCENT')}</option>
            <option value="AMOUNT">{t('referrals.kind.AMOUNT')}</option>
          </SelectField>
          {draft.friendKind === 'PERCENT' ? (
            <>
              <TextField
                label={t('referrals.program.friendPercent')}
                inputMode="decimal"
                value={draft.percent}
                onChange={(e) => patch({ percent: e.target.value })}
              />
              <TextField
                label={t('referrals.program.friendMaxDiscount')}
                inputMode="decimal"
                value={draft.maxDiscount}
                onChange={(e) => patch({ maxDiscount: e.target.value })}
              />
            </>
          ) : (
            <TextField
              label={t('referrals.program.friendAmount')}
              inputMode="decimal"
              value={draft.amount}
              onChange={(e) => patch({ amount: e.target.value })}
            />
          )}
          <TextField
            label={t('referrals.program.friendMinBasket')}
            inputMode="decimal"
            value={draft.minBasket}
            onChange={(e) => patch({ minBasket: e.target.value })}
          />
          <TextField
            label={t('referrals.program.rewardAmount')}
            inputMode="decimal"
            value={draft.reward}
            onChange={(e) => patch({ reward: e.target.value })}
          />
          <TextField
            label={t('referrals.program.rewardValidDays')}
            type="number"
            min={7}
            max={365}
            value={draft.validDays}
            onChange={(e) => patch({ validDays: e.target.value })}
          />
          <TextField
            label={t('referrals.program.cap')}
            type="number"
            min={1}
            max={100}
            value={draft.cap}
            onChange={(e) => patch({ cap: e.target.value })}
          />
        </div>
        {editable && (
          <div>
            <Button onClick={() => void save()} disabled={busy}>
              {t('referrals.program.save')}
            </Button>
          </div>
        )}
      </fieldset>
      <p className="ui-caption">{t('referrals.program.rules')}</p>
      {program && (
        <div className="flex flex-col gap-1 ui-rule pt-3" data-referral-stats>
          <h3 className="ui-heading">{t('referrals.stats.title')}</h3>
          <p>{t('referrals.stats.codes', { count: program.stats.codes })}</p>
          <p>
            {t('referrals.stats.friendOrders', {
              count: program.stats.friendOrders,
              amount: money(program.stats.friendDiscountMinor),
            })}
          </p>
          <p>
            {t('referrals.stats.rewards', {
              count: program.stats.rewardsGranted,
              amount: money(program.stats.rewardValueMinor),
              used: program.stats.rewardsUsed,
            })}
          </p>
          {program.stats.rewardsSkipped > 0 && (
            <p>{t('referrals.stats.skipped', { count: program.stats.rewardsSkipped })}</p>
          )}
        </div>
      )}
    </Card>
  );
}
