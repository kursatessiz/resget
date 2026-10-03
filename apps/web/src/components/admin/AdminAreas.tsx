'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ServiceAreaDTO } from '@resget/shared';
import { Badge, Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** Service areas: the marketplace opens one district at a time. */
export function AdminAreas({ locale }: { locale: string }) {
  const t = useT(locale);
  const [areas, setAreas] = useState<ServiceAreaDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ countryCode: 'TR', city: '', district: '' });

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    bffJson<ServiceAreaDTO[]>('admin/service-areas').then(setAreas).catch(fail);
  }, [fail]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      const created = await bffJson<ServiceAreaDTO>('admin/service-areas', {
        method: 'POST',
        body: JSON.stringify({
          countryCode: form.countryCode.trim().toUpperCase(),
          city: form.city.trim(),
          district: form.district.trim(),
        }),
      });
      setAreas((list) => [...(list ?? []), created]);
      setForm({ ...form, city: '', district: '' });
    });

  const toggle = (area: ServiceAreaDTO) =>
    run(async () => {
      const updated = await bffJson<ServiceAreaDTO>(`admin/service-areas/${area.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isLaunched: !area.isLaunched }),
      });
      setAreas((list) => list && list.map((a) => (a.id === updated.id ? updated : a)));
    });

  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('admin.areas.title')}</h1>
        <p className="ui-text-muted">{t('admin.areas.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}
      <Card title={t('admin.areas.add')} aria-label={t('admin.areas.add')}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <TextField
            id="area-country"
            label={t('admin.areas.country')}
            value={form.countryCode}
            onChange={(e) => setForm({ ...form, countryCode: e.target.value })}
            maxLength={2}
            pattern="[A-Za-z]{2}"
            required
          />
          <TextField
            id="area-city"
            label={t('admin.areas.city')}
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            required
          />
          <TextField
            id="area-district"
            label={t('admin.areas.district')}
            value={form.district}
            onChange={(e) => setForm({ ...form, district: e.target.value })}
            required
          />
          <Button type="submit" disabled={busy}>
            {t('admin.areas.add')}
          </Button>
        </form>
      </Card>
      <Card aria-label={t('admin.areas.title')}>
        {!areas ? (
          <p className="ui-text-muted">{t('common.loading')}</p>
        ) : areas.length === 0 ? (
          <p className="ui-text-muted">{t('admin.areas.empty')}</p>
        ) : (
          <ul className="ui-divide">
            {areas.map((area) => (
              <li
                key={area.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
                data-area={`${area.city}/${area.district}`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="ui-heading">
                    {area.city} / {area.district}
                  </span>
                  <span className="ui-text-muted">{area.countryCode}</span>
                  <Badge tone={area.isLaunched ? 'success' : 'muted'}>
                    {area.isLaunched ? t('admin.areas.launched') : t('admin.areas.notLaunched')}
                  </Badge>
                  <span className="ui-caption">
                    {t('admin.areas.restaurants', { count: area.restaurants, listed: area.listedRestaurants })}
                  </span>
                  {area.launchedAt && (
                    <span className="ui-caption">
                      {t('admin.areas.launchedAt', { date: dateFormat.format(new Date(area.launchedAt)) })}
                    </span>
                  )}
                </span>
                <Button
                  variant={area.isLaunched ? 'outline' : 'solid'}
                  tone={area.isLaunched ? 'warn' : 'theme'}
                  disabled={busy}
                  onClick={() => toggle(area)}
                >
                  {area.isLaunched ? t('admin.areas.close') : t('admin.areas.launch')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
