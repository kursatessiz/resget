'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MyPartnerReferralsDTO } from '@resget/shared';
import { Badge, Button, Card } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const STATUS_TONE: Record<MyPartnerReferralsDTO['referrals'][number]['status'], UiTone> = {
  PENDING: 'muted',
  REWARDED: 'success',
  CAPPED: 'muted',
};

/**
 * Invite a restaurant (docs/RESTORAN_TAVSIYE.md) on the plan page: the
 * restaurant's invite link, what both sides get, and the restaurants that
 * joined through it with their progress towards the reward.
 */
export function PartnerReferralCard({ restaurantId, locale }: { restaurantId: string; locale: string }) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/partner-referrals`;
  const [data, setData] = useState<MyPartnerReferralsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  useEffect(() => {
    bffJson<MyPartnerReferralsDTO>(base).then(setData).catch(fail);
  }, [base, fail]);
  if (!data) return error ? <p role="alert">{error}</p> : null;

  const link = data.code
    ? `${window.location.origin}/kayit?${new URLSearchParams({ davet: data.code }).toString()}`
    : '';
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  const getCode = async () => {
    setError(null);
    try {
      setData(await bffJson<MyPartnerReferralsDTO>(`${base}/code`, { method: 'POST', body: '{}' }));
    } catch (err) {
      fail(err);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card title={t('partnerReferrals.card.title')} aria-label={t('partnerReferrals.card.title')}>
      <p className="ui-text-muted">
        {t('partnerReferrals.card.intro', {
          bonus: data.refereeBonusDays,
          orders: data.qualifyingOrders,
          reward: data.referrerRewardDays,
        })}
      </p>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {!data.isActive ? (
        <p className="ui-caption">{t('partnerReferrals.card.off')}</p>
      ) : data.code ? (
        <div className="flex flex-wrap items-center gap-2">
          <input className="pui-input" readOnly aria-label={t('partnerReferrals.card.link')} value={link} />
          <Button variant="outline" tone="muted" onClick={() => void copy()}>
            {t('partnerReferrals.card.copy')}
          </Button>
          {copied && <span role="status">{t('partnerReferrals.card.copied')}</span>}
        </div>
      ) : (
        <div>
          <Button onClick={() => void getCode()}>{t('partnerReferrals.card.getCode')}</Button>
        </div>
      )}
      <p className="ui-heading">{t('partnerReferrals.card.earned', { days: data.rewardDaysEarned })}</p>
      {data.referrals.length === 0 ? (
        <p className="ui-caption">{t('partnerReferrals.card.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="pui-table w-full">
            <thead>
              <tr>
                <th scope="col">{t('partnerReferrals.card.colRestaurant')}</th>
                <th scope="col">{t('partnerReferrals.card.colJoined')}</th>
                <th scope="col">{t('partnerReferrals.card.colProgress')}</th>
                <th scope="col">{t('partnerReferrals.card.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {data.referrals.map((r, i) => (
                <tr key={`${r.restaurantName}-${i}`} data-partner-referral={r.restaurantName}>
                  <td>{r.restaurantName}</td>
                  <td>{date(r.createdAt)}</td>
                  <td>
                    {t('partnerReferrals.card.progress', {
                      done: Math.min(r.completedOrders, data.qualifyingOrders),
                      needed: data.qualifyingOrders,
                    })}
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[r.status]}>{t(`partnerReferrals.status.${r.status}`)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
