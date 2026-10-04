'use client';

import { useEffect, useState } from 'react';
import { DAILY_CAP_MAX, WEEKLY_CAP_MAX } from '@resget/shared';
import type { ConsentSettingsDTO } from '@resget/shared';
import { Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** How many campaign messages one customer may get per day and week (docs/RIZA.md). */
export function ConsentLimits({
  restaurantId,
  locale,
  canManage,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
}) {
  const t = useT(locale);
  const [settings, setSettings] = useState<ConsentSettingsDTO | null>(null);
  const [daily, setDaily] = useState('1');
  const [weekly, setWeekly] = useState('3');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `restaurants/${restaurantId}/consent/settings`;

  useEffect(() => {
    bffJson<ConsentSettingsDTO>(path)
      .then((s) => {
        setSettings(s);
        setDaily(String(s.policy.dailyCap));
        setWeekly(String(s.policy.weeklyCap));
      })
      .catch(() => setSettings(null));
  }, [path]);

  if (!settings) return null;
  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      const next = await bffJson<ConsentSettingsDTO>(path, {
        method: 'PUT',
        body: JSON.stringify({ dailyCap: Number(daily), weeklyCap: Number(weekly) }),
      });
      setSettings(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    }
  };

  return (
    <Card title={t('consent.limits.title')} aria-label={t('consent.limits.title')}>
      <p className="ui-text-muted">{t('consent.limits.intro')}</p>
      <form
        className="flex flex-col gap-3 md:flex-row md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TextField
          label={t('consent.limits.daily')}
          type="number"
          min={1}
          max={DAILY_CAP_MAX}
          value={daily}
          disabled={!canManage}
          onChange={(e) => setDaily(e.target.value)}
        />
        <TextField
          label={t('consent.limits.weekly')}
          type="number"
          min={1}
          max={WEEKLY_CAP_MAX}
          value={weekly}
          disabled={!canManage}
          onChange={(e) => setWeekly(e.target.value)}
        />
        {canManage && <Button type="submit">{t('consent.limits.save')}</Button>}
      </form>
      {saved && <p role="status">{t('consent.limits.saved')}</p>}
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
    </Card>
  );
}
