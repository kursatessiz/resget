'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type { MyReferralDTO } from '@resget/shared';
import { Badge, Button, Card } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * Invite a friend (docs/TAVSIYE.md): for every restaurant running a
 * referral programme where this customer has ordered, the offer, their
 * personal code and share link, and the reward coupons they have earned.
 * Hidden when no restaurant runs one.
 */
export function MyReferrals({ locale }: { locale: string }) {
  const t = useT(locale);
  const [items, setItems] = useState<MyReferralDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  useEffect(() => {
    bffJson<MyReferralDTO[]>('me/referrals').then(setItems).catch(fail);
  }, [fail]);

  if (items.length === 0) return error ? <p role="alert">{error}</p> : null;

  const linkOf = (r: MyReferralDTO) =>
    r.code ? `${window.location.origin}/${r.slug}?${new URLSearchParams({ kod: r.code }).toString()}` : '';
  const getCode = async (r: MyReferralDTO) => {
    setError(null);
    try {
      const updated = await bffJson<MyReferralDTO>(`me/referrals/${r.restaurantId}/code`, {
        method: 'POST',
        body: '{}',
      });
      setItems((all) => all.map((x) => (x.restaurantId === updated.restaurantId ? updated : x)));
    } catch (err) {
      fail(err);
    }
  };
  const copy = async (r: MyReferralDTO) => {
    try {
      await navigator.clipboard.writeText(linkOf(r));
      setCopied(r.restaurantId);
    } catch {
      setCopied(null);
    }
  };

  return (
    <Card title={t('referrals.account.title')} aria-label={t('referrals.account.title')}>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      <ul className="flex flex-col ui-divide">
        {items.map((r) => {
          const money = (minor: number) => formatMoney({ amountMinor: minor, currency: r.currency }, locale);
          const offer =
            r.friendKind === 'PERCENT'
              ? r.friendMaxDiscountMinor
                ? t('referrals.account.offerPercentCapped', {
                    percent: (r.friendPercentBps ?? 0) / 100,
                    max: money(r.friendMaxDiscountMinor),
                  })
                : t('referrals.account.offerPercent', { percent: (r.friendPercentBps ?? 0) / 100 })
              : t('referrals.account.offerAmount', { amount: money(r.friendAmountMinor ?? 0) });
          return (
            <li key={r.restaurantId} className="flex flex-col gap-2 py-3" data-referral={r.slug}>
              <h3 className="ui-heading">{r.name}</h3>
              <p>{offer}</p>
              {r.friendMinBasketMinor > 0 && (
                <p className="ui-caption">
                  {t('referrals.account.minBasket', { amount: money(r.friendMinBasketMinor) })}
                </p>
              )}
              <p className="ui-caption">
                {t('referrals.account.reward', { amount: money(r.rewardAmountMinor), days: r.rewardValidDays })}
              </p>
              {r.code ? (
                <div className="flex flex-col gap-2">
                  <p className="ui-heading">{t('referrals.account.code', { code: r.code })}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input className="pui-input" readOnly aria-label={t('referrals.account.link')} value={linkOf(r)} />
                    <Button variant="outline" tone="muted" onClick={() => void copy(r)}>
                      {t('referrals.account.copy')}
                    </Button>
                  </div>
                  {copied === r.restaurantId && <p role="status">{t('referrals.account.copied')}</p>}
                </div>
              ) : (
                <div>
                  <Button onClick={() => void getCode(r)}>{t('referrals.account.getCode')}</Button>
                </div>
              )}
              {r.rewards.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="ui-caption">{t('referrals.account.rewards')}</p>
                  <ul className="flex flex-col gap-1">
                    {r.rewards.map((w) => (
                      <li key={w.code} className="flex flex-wrap items-center gap-2" data-reward={w.code}>
                        <span>{t('referrals.account.rewardLine', { code: w.code, amount: money(w.amountMinor) })}</span>
                        {w.used ? (
                          <Badge tone="muted">{t('referrals.account.rewardUsed')}</Badge>
                        ) : (
                          w.endsAt && (
                            <span className="ui-caption">
                              {t('referrals.account.rewardEnds', {
                                date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                                  new Date(w.endsAt),
                                ),
                              })}
                            </span>
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
