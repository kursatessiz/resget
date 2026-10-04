'use client';

import { useEffect, useState } from 'react';
import { WEEKDAY_KEYS, hoursAreValid } from '@resget/shared';
import type { BranchHoursDTO, OpeningHours, WeekdayKey } from '@resget/shared';
import { Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

type Windows = Record<WeekdayKey, [string, string][]>;

const DEFAULT_WINDOW: [string, string] = ['10:00', '22:00'];

function toWindows(hours: OpeningHours | null): Windows {
  return Object.fromEntries(WEEKDAY_KEYS.map((day) => [day, [...(hours?.[day] ?? [])]])) as Windows;
}

/**
 * Weekly opening hours per branch (docs/SIPARIS_VE_SEVK.md, "Sipariş alma
 * durumu"). They feed the marketplace "open now" label and, with the order
 * availability module on, refuse consumer orders outside them. A day with
 * no window is closed; no hours at all means unknown, never closed.
 */
export function OpeningHoursEditor({
  restaurantId,
  locale,
  canManage,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
}) {
  const t = useT(locale);
  const [branches, setBranches] = useState<BranchHoursDTO[]>([]);
  const [branchId, setBranchId] = useState('');
  const [windows, setWindows] = useState<Windows>(toWindows(null));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const path = `restaurants/${restaurantId}/opening-hours`;

  const show = (list: BranchHoursDTO[], id: string) => {
    setBranches(list);
    const branch = list.find((b) => b.branchId === id) ?? list[0];
    if (!branch) return;
    setBranchId(branch.branchId);
    setWindows(toWindows(branch.hours));
  };

  useEffect(() => {
    bffJson<BranchHoursDTO[]>(path)
      .then((list) => show(list, ''))
      .catch(() => setMessage(t('common.error.network')));
    // Loaded once; saving refreshes the list from the response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (branches.length === 0) return null;

  const hours: OpeningHours = Object.fromEntries(
    WEEKDAY_KEYS.filter((day) => windows[day].length > 0).map((day) => [day, windows[day]]),
  );
  const valid = hoursAreValid(hours);

  const setWindow = (day: WeekdayKey, index: number, side: 0 | 1, value: string) => {
    const next = windows[day].map((w, i) => (i === index ? (side === 0 ? [value, w[1]] : [w[0], value]) : w)) as [
      string,
      string,
    ][];
    setWindows({ ...windows, [day]: next });
  };

  const save = async (value: OpeningHours | null) => {
    setBusy(true);
    setMessage(null);
    try {
      const list = await bffJson<BranchHoursDTO[]>(path, {
        method: 'PUT',
        body: JSON.stringify({ branchId, hours: value }),
      });
      show(list, branchId);
      setMessage(t('settings.hours.saved'));
    } catch (err) {
      setMessage(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('settings.hours.title')} aria-label={t('settings.hours.title')}>
      <div className="flex flex-col gap-4">
        <p className="ui-caption">{t('settings.hours.intro')}</p>
        {branches.length > 1 && (
          <SelectField
            id="hours-branch"
            label={t('settings.hours.title')}
            value={branchId}
            onChange={(event) => show(branches, event.target.value)}
          >
            {branches.map((b) => (
              <option key={b.branchId} value={b.branchId}>
                {b.name}
              </option>
            ))}
          </SelectField>
        )}
        <ul className="ui-divide">
          {WEEKDAY_KEYS.map((day) => (
            <li key={day} className="flex flex-col gap-2 py-2" data-hours-day={day}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{t(`settings.hours.day.${day}`)}</span>
                {windows[day].length === 0 && <span className="ui-caption">{t('settings.hours.closed')}</span>}
              </div>
              {windows[day].map(([open, close], index) => (
                <div key={index} className="flex flex-wrap items-end gap-2">
                  <TextField
                    id={`hours-${day}-${index}-open`}
                    label={t('settings.hours.open')}
                    type="time"
                    value={open}
                    disabled={!canManage}
                    onChange={(event) => setWindow(day, index, 0, event.target.value)}
                  />
                  <TextField
                    id={`hours-${day}-${index}-close`}
                    label={t('settings.hours.close')}
                    type="time"
                    value={close}
                    disabled={!canManage}
                    onChange={(event) => setWindow(day, index, 1, event.target.value)}
                  />
                  {canManage && (
                    <Button
                      variant="outline"
                      tone="muted"
                      onClick={() => setWindows({ ...windows, [day]: windows[day].filter((_, i) => i !== index) })}
                    >
                      {t('settings.hours.removeWindow')}
                    </Button>
                  )}
                </div>
              ))}
              {canManage && windows[day].length < 4 && (
                <div>
                  <Button
                    variant="soft"
                    onClick={() => setWindows({ ...windows, [day]: [...windows[day], DEFAULT_WINDOW] })}
                  >
                    {t('settings.hours.addWindow')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!valid && <p role="alert">{t('settings.hours.invalid')}</p>}
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save(hours)} disabled={busy || !valid}>
              {t('settings.hours.save')}
            </Button>
            <Button variant="outline" tone="muted" onClick={() => void save(null)} disabled={busy}>
              {t('settings.hours.clear')}
            </Button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </Card>
  );
}
