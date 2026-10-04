'use client';

import { useCallback, useEffect, useState } from 'react';
import { CreateCouponSchema, formatMoney, parseMajorAmount } from '@resget/shared';
import type { CouponDTO, CouponKind, RestaurantSettingsDTO } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

interface Draft {
  code: string;
  kind: CouponKind;
  percent: string;
  maxDiscount: string;
  amount: string;
  minBasket: string;
  firstOrderOnly: boolean;
  perCustomerLimit: string;
  maxRedemptions: string;
  startsAt: string;
  endsAt: string;
}

const EMPTY: Draft = {
  code: '',
  kind: 'PERCENT',
  percent: '10',
  maxDiscount: '',
  amount: '',
  minBasket: '0',
  firstOrderOnly: false,
  perCustomerLimit: '1',
  maxRedemptions: '',
  startsAt: '',
  endsAt: '',
};

/** A datetime-local value in the viewer's clock as an ISO instant; empty stays empty. */
const instant = (local: string) => (local ? new Date(local).toISOString() : null);

/** Coupons and promo codes (docs/KUPONLAR.md): the list with its usage, a new coupon, pause and delete. */
export function CouponsManager({
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
  const base = `restaurants/${restaurantId}/coupons`;
  const [currency, setCurrency] = useState<string | null>(null);
  const [coupons, setCoupons] = useState<CouponDTO[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    Promise.all([bffJson<RestaurantSettingsDTO>(`restaurants/${restaurantId}`), bffJson<CouponDTO[]>(base)])
      .then(([settings, list]) => {
        setCurrency(settings.currency);
        setCoupons(list);
      })
      .catch(fail);
  }, [base, restaurantId, fail]);

  if (!currency) return error ? <p role="alert">{error}</p> : null;

  const money = (minor: number) => formatMoney({ amountMinor: minor, currency }, locale);
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  const number = (text: string) => (text.trim() === '' ? null : Number(text));
  const input = {
    code: draft.code,
    minBasketMinor: parseMajorAmount(draft.minBasket || '0', currency) ?? -1,
    firstOrderOnly: draft.firstOrderOnly,
    perCustomerLimit: number(draft.perCustomerLimit) ?? 0,
    maxRedemptions: number(draft.maxRedemptions),
    startsAt: instant(draft.startsAt),
    endsAt: instant(draft.endsAt),
    ...(draft.kind === 'PERCENT'
      ? {
          kind: 'PERCENT' as const,
          percentBps: Math.round(Number(draft.percent.replace(',', '.')) * 100),
          maxDiscountMinor: draft.maxDiscount.trim() ? (parseMajorAmount(draft.maxDiscount, currency) ?? 0) : null,
        }
      : { kind: 'AMOUNT' as const, amountMinor: parseMajorAmount(draft.amount, currency) ?? 0 }),
  };
  const parsed = CreateCouponSchema.safeParse(input);

  const create = async () => {
    if (!parsed.success) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const coupon = await bffJson<CouponDTO>(base, { method: 'POST', body: JSON.stringify(parsed.data) });
      setCoupons([coupon, ...coupons]);
      setDraft(EMPTY);
      setNotice(t('coupons.created'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (coupon: CouponDTO) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await bffJson<CouponDTO>(`${base}/${coupon.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !coupon.isActive }),
      });
      setCoupons(coupons.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (coupon: CouponDTO) => {
    setBusy(true);
    setError(null);
    try {
      await bffJson<void>(`${base}/${coupon.id}`, { method: 'DELETE' });
      setCoupons(coupons.filter((c) => c.id !== coupon.id));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const value = (c: CouponDTO) =>
    c.kind === 'PERCENT'
      ? c.maxDiscountMinor
        ? t('coupons.value.PERCENT.capped', { percent: (c.percentBps ?? 0) / 100, max: money(c.maxDiscountMinor) })
        : t('coupons.value.PERCENT', { percent: (c.percentBps ?? 0) / 100 })
      : t('coupons.value.AMOUNT', { amount: money(c.amountMinor ?? 0) });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="ui-title">{t('coupons.title')}</h1>
      <p className="ui-text-muted">{t('coupons.intro')}</p>
      {!isPro && <p role="status">{t('coupons.proRequired')}</p>}

      <Card title={t('coupons.title')} aria-label={t('coupons.title')}>
        {coupons.length === 0 ? (
          <p className="ui-text-muted">{t('coupons.empty')}</p>
        ) : (
          <ul className="ui-divide">
            {coupons.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 py-3" data-coupon={c.code}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="ui-heading">{c.code}</span>
                  <Badge tone={c.isActive ? 'success' : 'muted'}>
                    {c.isActive ? t('coupons.active') : t('coupons.paused')}
                  </Badge>
                </div>
                <span>{value(c)}</span>
                <span className="ui-caption">
                  {[
                    c.minBasketMinor > 0 ? t('coupons.rule.minBasket', { amount: money(c.minBasketMinor) }) : null,
                    c.firstOrderOnly ? t('coupons.rule.firstOrder') : null,
                    c.startsAt || c.endsAt
                      ? t('coupons.rule.window', {
                          from: c.startsAt ? date(c.startsAt) : '',
                          to: c.endsAt ? date(c.endsAt) : '',
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' / ')}
                </span>
                <span className="ui-caption">
                  {c.maxRedemptions
                    ? t('coupons.usageLimited', {
                        count: c.redemptionCount,
                        max: c.maxRedemptions,
                        amount: money(c.discountTotalMinor),
                      })
                    : t('coupons.usage', { count: c.redemptionCount, amount: money(c.discountTotalMinor) })}
                </span>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" tone="muted" onClick={() => void toggle(c)} disabled={busy}>
                      {c.isActive ? t('coupons.pause') : t('coupons.resume')}
                    </Button>
                    {c.redemptionCount === 0 && c.discountTotalMinor === 0 && (
                      <Button variant="outline" tone="error" onClick={() => void remove(c)} disabled={busy}>
                        {t('coupons.delete')}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="ui-caption">{t('coupons.deleteHint')}</p>
      </Card>

      {canManage && isPro && (
        <Card title={t('coupons.new')} aria-label={t('coupons.new')}>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              id="coupon-code"
              label={t('coupons.code')}
              help={t('coupons.codeHelp')}
              value={draft.code}
              maxLength={24}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
            />
            <SelectField
              id="coupon-kind"
              label={t('coupons.kind')}
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as CouponKind })}
            >
              <option value="PERCENT">{t('coupons.kind.PERCENT')}</option>
              <option value="AMOUNT">{t('coupons.kind.AMOUNT')}</option>
            </SelectField>
            {draft.kind === 'PERCENT' ? (
              <>
                <TextField
                  id="coupon-percent"
                  label={t('coupons.percent')}
                  inputMode="decimal"
                  value={draft.percent}
                  onChange={(e) => setDraft({ ...draft, percent: e.target.value })}
                />
                <TextField
                  id="coupon-max-discount"
                  label={t('coupons.maxDiscount', { currency })}
                  help={t('coupons.maxDiscountHelp')}
                  inputMode="decimal"
                  value={draft.maxDiscount}
                  onChange={(e) => setDraft({ ...draft, maxDiscount: e.target.value })}
                />
              </>
            ) : (
              <TextField
                id="coupon-amount"
                label={t('coupons.amount', { currency })}
                inputMode="decimal"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              />
            )}
            <TextField
              id="coupon-min-basket"
              label={t('coupons.minBasket', { currency })}
              inputMode="decimal"
              value={draft.minBasket}
              onChange={(e) => setDraft({ ...draft, minBasket: e.target.value })}
            />
            <TextField
              id="coupon-per-customer"
              label={t('coupons.perCustomerLimit')}
              inputMode="numeric"
              value={draft.perCustomerLimit}
              onChange={(e) => setDraft({ ...draft, perCustomerLimit: e.target.value })}
            />
            <TextField
              id="coupon-max-redemptions"
              label={t('coupons.maxRedemptions')}
              help={t('coupons.maxRedemptionsHelp')}
              inputMode="numeric"
              value={draft.maxRedemptions}
              onChange={(e) => setDraft({ ...draft, maxRedemptions: e.target.value })}
            />
            <TextField
              id="coupon-starts"
              label={t('coupons.startsAt')}
              type="datetime-local"
              value={draft.startsAt}
              onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
            />
            <TextField
              id="coupon-ends"
              label={t('coupons.endsAt')}
              type="datetime-local"
              value={draft.endsAt}
              onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
            />
            <label className="flex items-center gap-2 md:col-span-2">
              <input
                type="checkbox"
                className="pui-checkbox"
                checked={draft.firstOrderOnly}
                onChange={(e) => setDraft({ ...draft, firstOrderOnly: e.target.checked })}
              />
              <span>{t('coupons.firstOrderOnly')}</span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-3">
            <Button onClick={() => void create()} disabled={busy || !parsed.success}>
              {t('coupons.create')}
            </Button>
            {!parsed.success && draft.code.length > 0 && <span className="ui-caption">{t('coupons.invalid')}</span>}
          </div>
        </Card>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
