'use client';

import { useEffect, useState } from 'react';
import { SCHEDULING_SLOT_MINUTES } from '@resget/shared';
import type { SchedulingSettings, SchedulingSlotMinutes } from '@resget/shared';
import { Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * Scheduled orders (docs/ILERI_TARIHLI_SIPARIS.md): whether customers may
 * pick a later slot, how long slots are, how far ahead they start and end,
 * and how much earlier a delivery slot has to be ready.
 */
export function SchedulingEditor({
  restaurantId,
  locale,
  canManage,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
}) {
  const t = useT(locale);
  const path = `restaurants/${restaurantId}/scheduling`;
  const [settings, setSettings] = useState<SchedulingSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    bffJson<SchedulingSettings>(path)
      .then(setSettings)
      .catch(() => setMessage({ tone: 'error', text: t('common.error.network') }));
  }, [path, t]);

  if (!settings) return null;
  const set = <K extends keyof SchedulingSettings>(key: K, value: SchedulingSettings[K]) =>
    setSettings({ ...settings, [key]: value });
  const number = (value: string) => (value === '' ? 0 : Number(value));

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setSettings(await bffJson<SchedulingSettings>(path, { method: 'PUT', body: JSON.stringify(settings) }));
      setMessage({ tone: 'success', text: t('scheduling.saved') });
    } catch (err) {
      setMessage({
        tone: 'error',
        text: err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('scheduling.title')} aria-label={t('scheduling.title')}>
      <p className="ui-text-muted">{t('scheduling.intro')}</p>
      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`pui-alert pui-${message.tone}`}>
          {message.text}
        </p>
      )}
      <fieldset className="flex flex-col gap-4" disabled={!canManage || busy}>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="pui-checkbox"
            checked={settings.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          <span>{t('scheduling.enabled')}</span>
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField
            id="scheduling-slot"
            label={t('scheduling.slotMinutes')}
            value={String(settings.slotMinutes)}
            onChange={(e) => set('slotMinutes', Number(e.target.value) as SchedulingSlotMinutes)}
          >
            {SCHEDULING_SLOT_MINUTES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {t('scheduling.minutes', { count: minutes })}
              </option>
            ))}
          </SelectField>
          <TextField
            id="scheduling-lead"
            type="number"
            min={15}
            max={1440}
            label={t('scheduling.minLeadMinutes')}
            help={t('scheduling.minLeadHelp')}
            value={settings.minLeadMinutes}
            onChange={(e) => set('minLeadMinutes', number(e.target.value))}
          />
          <TextField
            id="scheduling-days"
            type="number"
            min={1}
            max={7}
            label={t('scheduling.maxDaysAhead')}
            value={settings.maxDaysAhead}
            onChange={(e) => set('maxDaysAhead', number(e.target.value))}
          />
          <TextField
            id="scheduling-delivery"
            type="number"
            min={0}
            max={120}
            label={t('scheduling.deliveryLeadMinutes')}
            help={t('scheduling.deliveryLeadHelp')}
            value={settings.deliveryLeadMinutes}
            onChange={(e) => set('deliveryLeadMinutes', number(e.target.value))}
          />
        </div>
        {canManage && (
          <div>
            <Button onClick={() => void save()} disabled={busy}>
              {t('scheduling.save')}
            </Button>
          </div>
        )}
      </fieldset>
    </Card>
  );
}
