'use client';

import { useEffect, useState } from 'react';
import { UpdateSendLimitSchema } from '@resget/shared';
import type { SendLimitDTO } from '@resget/shared';
import { Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * Recipient caps for one tenant's campaigns (docs/ONAYLAR.md): per campaign
 * and over the last 24 hours. They apply while the tenant's
 * marketing_approvals module is on; an empty field means no limit.
 */
export function AdminSendLimits({ restaurantId, locale }: { restaurantId: string; locale: string }) {
  const t = useT(locale);
  const path = `admin/send-limits/${restaurantId}`;
  const [limit, setLimit] = useState<SendLimitDTO | null>(null);
  const [perCampaign, setPerCampaign] = useState('');
  const [perDay, setPerDay] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = (row: SendLimitDTO) => {
    setLimit(row);
    setPerCampaign(row.maxPerCampaign === null ? '' : String(row.maxPerCampaign));
    setPerDay(row.maxPerDay === null ? '' : String(row.maxPerDay));
  };
  useEffect(() => {
    bffJson<SendLimitDTO>(path)
      .then(show)
      .catch(() => setLimit(null));
  }, [path]);

  if (!limit) return null;
  const save = async () => {
    setError(null);
    setSaved(false);
    const parsed = UpdateSendLimitSchema.safeParse({
      maxPerCampaign: perCampaign.trim() ? Number(perCampaign) : null,
      maxPerDay: perDay.trim() ? Number(perDay) : null,
    });
    if (!parsed.success) {
      setError(t('approvals.limits.invalid'));
      return;
    }
    try {
      show(await bffJson<SendLimitDTO>(path, { method: 'PUT', body: JSON.stringify(parsed.data) }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    }
  };

  return (
    <Card title={t('approvals.limits.title')} aria-label={t('approvals.limits.title')}>
      <p className="ui-text-muted">{t('approvals.limits.intro')}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField
          label={t('approvals.limits.perCampaign')}
          type="number"
          min={1}
          value={perCampaign}
          onChange={(e) => setPerCampaign(e.target.value)}
        />
        <TextField
          label={t('approvals.limits.perDay')}
          type="number"
          min={1}
          value={perDay}
          onChange={(e) => setPerDay(e.target.value)}
        />
      </div>
      <p className="ui-caption">{t('approvals.limits.used', { count: limit.usedLast24h })}</p>
      <div>
        <Button onClick={() => void save()}>{t('approvals.limits.save')}</Button>
      </div>
      {saved && <p role="status">{t('approvals.limits.saved')}</p>}
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
    </Card>
  );
}
