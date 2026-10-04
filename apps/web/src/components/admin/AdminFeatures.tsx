'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FEATURE_GROUPS } from '@resget/shared';
import type { AdminFeatureDTO, FeatureKey, RestaurantFeatureDTO } from '@resget/shared';
import { Badge, Card, SelectField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

type SwitchValue = 'default' | 'on' | 'off';

function toValue(enabled: boolean | null): SwitchValue {
  return enabled === null ? 'default' : enabled ? 'on' : 'off';
}

function toEnabled(value: SwitchValue): boolean | null {
  return value === 'default' ? null : value === 'on';
}

/**
 * Module switches (docs/OZELLIK_ANAHTARLARI.md): every module of the product,
 * grouped, with its global switch and the restaurants that differ. A
 * restaurant's own switch is set on its page in the console.
 */
export function AdminFeatures({ locale }: { locale: string }) {
  const t = useT(locale);
  const [features, setFeatures] = useState<AdminFeatureDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<FeatureKey | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    bffJson<AdminFeatureDTO[]>('admin/features').then(setFeatures).catch(fail);
  }, [fail]);

  const setGlobal = async (key: FeatureKey, value: SwitchValue) => {
    setBusy(key);
    setError(null);
    try {
      setFeatures(
        await bffJson<AdminFeatureDTO[]>(`admin/features/${key}`, {
          method: 'PUT',
          body: JSON.stringify({ enabled: toEnabled(value) }),
        }),
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  if (!features) return <p className="ui-text-muted">{error ?? t('common.loading')}</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="ui-title">{t('admin.features.title')}</h1>
        <p className="ui-text-muted">{t('admin.features.intro')}</p>
      </div>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {FEATURE_GROUPS.map((group) => {
        const items = features.filter((f) => f.group === group);
        if (items.length === 0) return null;
        return (
          <Card key={group} title={t(`admin.features.group.${group}`)} aria-label={t(`admin.features.group.${group}`)}>
            <ul className="ui-divide">
              {items.map((feature) => (
                <li key={feature.key} className="flex flex-col gap-2 py-3" data-feature={feature.key}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="ui-heading">{t(`features.${feature.key}.name`)}</span>
                        <Badge tone={feature.enabled ? 'success' : 'muted'}>
                          {feature.enabled ? t('admin.features.on') : t('admin.features.off')}
                        </Badge>
                        {feature.stage === 'BETA' && <Badge tone="warn">{t('admin.features.beta')}</Badge>}
                      </span>
                      <span className="ui-caption">{t(`features.${feature.key}.description`)}</span>
                    </div>
                    <div className="w-56">
                      <SelectField
                        id={`feature-${feature.key}`}
                        label={t('admin.features.global')}
                        value={toValue(feature.global)}
                        disabled={busy === feature.key}
                        onChange={(event) => void setGlobal(feature.key, event.target.value as SwitchValue)}
                      >
                        <option value="default">
                          {t('admin.features.followDefault', {
                            state: feature.defaultEnabled ? t('admin.features.on') : t('admin.features.off'),
                          })}
                        </option>
                        <option value="on">{t('admin.features.on')}</option>
                        <option value="off">{t('admin.features.off')}</option>
                      </SelectField>
                    </div>
                  </div>
                  {feature.overrides.length > 0 && (
                    <p className="ui-caption">
                      {t('admin.features.overrides')}:{' '}
                      {feature.overrides.map((o, index) => (
                        <span key={o.restaurantId}>
                          {index > 0 ? ', ' : ''}
                          <Link href={`/admin/restoranlar/${o.restaurantId}`}>{o.restaurantName}</Link> (
                          {o.enabled ? t('admin.features.on') : t('admin.features.off')})
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

/** A restaurant's own switches on its console page; each one wins over the global switch. */
export function RestaurantFeatures({ restaurantId, locale }: { restaurantId: string; locale: string }) {
  const t = useT(locale);
  const [features, setFeatures] = useState<RestaurantFeatureDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<FeatureKey | null>(null);
  const base = `admin/restaurants/${restaurantId}/features`;

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    bffJson<RestaurantFeatureDTO[]>(base).then(setFeatures).catch(fail);
  }, [base, fail]);

  const set = async (key: FeatureKey, value: SwitchValue) => {
    setBusy(key);
    setError(null);
    try {
      setFeatures(
        await bffJson<RestaurantFeatureDTO[]>(`${base}/${key}`, {
          method: 'PUT',
          body: JSON.stringify({ enabled: toEnabled(value) }),
        }),
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title={t('admin.features.restaurantTitle')} aria-label={t('admin.features.restaurantTitle')}>
      <div className="flex flex-col gap-3">
        <p className="ui-caption">{t('admin.features.restaurantIntro')}</p>
        {error && (
          <p role="alert" className="pui-alert pui-error">
            {error}
          </p>
        )}
        {!features ? (
          <p className="ui-caption">{t('common.loading')}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {features.map((feature) => (
              <SelectField
                key={feature.key}
                id={`restaurant-feature-${feature.key}`}
                label={`${t(`features.${feature.key}.name`)} (${
                  feature.enabled ? t('admin.features.on') : t('admin.features.off')
                })`}
                value={toValue(feature.override)}
                disabled={busy === feature.key}
                onChange={(event) => void set(feature.key, event.target.value as SwitchValue)}
              >
                <option value="default">{t('admin.features.followGlobal')}</option>
                <option value="on">{t('admin.features.on')}</option>
                <option value="off">{t('admin.features.off')}</option>
              </SelectField>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
