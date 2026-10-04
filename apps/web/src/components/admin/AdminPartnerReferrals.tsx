'use client';

import { useCallback, useEffect, useState } from 'react';
import { UpdatePartnerReferralConfigSchema } from '@resget/shared';
import type { AdminPartnerReferralDTO, PartnerReferralConfigDTO } from '@resget/shared';
import { Badge, Button, Card, TextField } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const STATUS_TONE: Record<AdminPartnerReferralDTO['status'], UiTone> = {
  PENDING: 'muted',
  REWARDED: 'success',
  CAPPED: 'muted',
};

interface Draft {
  isActive: boolean;
  referrerRewardDays: string;
  refereeBonusDays: string;
  qualifyingOrders: string;
  yearlyCapPerReferrer: string;
}

/** The console's restaurant referral settings and every invitation with its progress. */
export function AdminPartnerReferrals({ locale }: { locale: string }) {
  const t = useT(locale);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rows, setRows] = useState<AdminPartnerReferralDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const toDraft = (c: PartnerReferralConfigDTO): Draft => ({
    isActive: c.isActive,
    referrerRewardDays: String(c.referrerRewardDays),
    refereeBonusDays: String(c.refereeBonusDays),
    qualifyingOrders: String(c.qualifyingOrders),
    yearlyCapPerReferrer: String(c.yearlyCapPerReferrer),
  });
  useEffect(() => {
    Promise.all([
      bffJson<PartnerReferralConfigDTO>('admin/partner-referrals/config'),
      bffJson<AdminPartnerReferralDTO[]>('admin/partner-referrals'),
    ])
      .then(([config, list]) => {
        setDraft(toDraft(config));
        setRows(list);
      })
      .catch(fail);
  }, [fail]);

  if (!draft) return error ? <p role="alert">{error}</p> : null;
  const patch = (fields: Partial<Draft>) => setDraft({ ...draft, ...fields });
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

  const save = async () => {
    setError(null);
    setNotice(null);
    const parsed = UpdatePartnerReferralConfigSchema.safeParse({
      isActive: draft.isActive,
      referrerRewardDays: Number(draft.referrerRewardDays),
      refereeBonusDays: Number(draft.refereeBonusDays),
      qualifyingOrders: Number(draft.qualifyingOrders),
      yearlyCapPerReferrer: Number(draft.yearlyCapPerReferrer),
    });
    if (!parsed.success) {
      setError(t('partnerReferrals.admin.invalid'));
      return;
    }
    setBusy(true);
    try {
      const saved = await bffJson<PartnerReferralConfigDTO>('admin/partner-referrals/config', {
        method: 'PUT',
        body: JSON.stringify(parsed.data),
      });
      setDraft(toDraft(saved));
      setNotice(t('partnerReferrals.admin.saved'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const number = (key: keyof Omit<Draft, 'isActive'>, label: string, min: number, max: number) => (
    <TextField
      label={label}
      type="number"
      min={min}
      max={max}
      value={draft[key]}
      onChange={(e) => patch({ [key]: e.target.value })}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('partnerReferrals.admin.title')}</h1>
        <p className="ui-text-muted">{t('partnerReferrals.admin.intro')}</p>
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
      <Card>
        <fieldset className="flex flex-col gap-3" disabled={busy}>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="pui-checkbox"
              checked={draft.isActive}
              onChange={(e) => patch({ isActive: e.target.checked })}
            />
            <span>{t('partnerReferrals.admin.active')}</span>
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            {number('referrerRewardDays', t('partnerReferrals.admin.referrerRewardDays'), 0, 365)}
            {number('refereeBonusDays', t('partnerReferrals.admin.refereeBonusDays'), 0, 365)}
            {number('qualifyingOrders', t('partnerReferrals.admin.qualifyingOrders'), 1, 1000)}
            {number('yearlyCapPerReferrer', t('partnerReferrals.admin.yearlyCap'), 1, 100)}
          </div>
          <div>
            <Button onClick={() => void save()}>{t('partnerReferrals.admin.save')}</Button>
          </div>
        </fieldset>
      </Card>
      <section className="flex flex-col gap-3" aria-label={t('partnerReferrals.admin.listTitle')}>
        <h2 className="ui-heading">{t('partnerReferrals.admin.listTitle')}</h2>
        {rows.length === 0 ? (
          <p className="ui-text-muted">{t('partnerReferrals.admin.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="pui-table w-full">
              <thead>
                <tr>
                  <th scope="col">{t('partnerReferrals.admin.colReferrer')}</th>
                  <th scope="col">{t('partnerReferrals.admin.colReferee')}</th>
                  <th scope="col">{t('partnerReferrals.card.colJoined')}</th>
                  <th scope="col">{t('partnerReferrals.admin.colBonus')}</th>
                  <th scope="col">{t('partnerReferrals.card.colProgress')}</th>
                  <th scope="col">{t('partnerReferrals.admin.colReward')}</th>
                  <th scope="col">{t('partnerReferrals.card.colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.referee.id} data-partner-referral={r.referee.slug}>
                    <td>{r.referrer.name}</td>
                    <td>{r.referee.name}</td>
                    <td>{date(r.createdAt)}</td>
                    <td>{t('partnerReferrals.admin.days', { days: r.refereeBonusDays })}</td>
                    <td>{r.completedOrders}</td>
                    <td>{r.rewardDays === null ? '-' : t('partnerReferrals.admin.days', { days: r.rewardDays })}</td>
                    <td>
                      <Badge tone={STATUS_TONE[r.status]}>{t(`partnerReferrals.status.${r.status}`)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
