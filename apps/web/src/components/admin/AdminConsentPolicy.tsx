'use client';

import { useEffect, useState } from 'react';
import { CONSENT_REGIONS } from '@resget/shared';
import type { ConsentRegion, ConsentSettingsDTO } from '@resget/shared';
import { Button, Card } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * The platform owner's consent switches for one tenant (docs/RIZA.md):
 * which regions need the confirmation link, and the TR merchant exemption.
 */
export function AdminConsentPolicy({ restaurantId, locale }: { restaurantId: string; locale: string }) {
  const t = useT(locale);
  const [settings, setSettings] = useState<ConsentSettingsDTO | null>(null);
  const [regions, setRegions] = useState<ConsentRegion[]>([]);
  const [exemption, setExemption] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `admin/restaurants/${restaurantId}/consent-policy`;

  useEffect(() => {
    bffJson<ConsentSettingsDTO>(path)
      .then((s) => {
        setSettings(s);
        setRegions([...s.policy.doubleOptInRegions]);
        setExemption(s.policy.merchantExemption);
      })
      .catch(() => setSettings(null));
  }, [path]);

  if (!settings) return null;
  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      setSettings(
        await bffJson<ConsentSettingsDTO>(path, {
          method: 'PUT',
          body: JSON.stringify({ doubleOptInRegions: regions, merchantExemption: exemption }),
        }),
      );
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    }
  };

  return (
    <Card title={t('consent.policy.title')} aria-label={t('consent.policy.title')}>
      <p className="ui-text-muted">{t('consent.policy.intro')}</p>
      {!settings.enabled && <p className="ui-caption">{t('consent.policy.moduleOff')}</p>}
      <fieldset className="flex flex-col gap-2">
        <legend className="ui-heading">{t('consent.policy.doubleOptIn')}</legend>
        {CONSENT_REGIONS.map((region) => (
          <label key={region} className="flex items-center gap-2">
            <input
              type="checkbox"
              className="pui-checkbox"
              checked={regions.includes(region)}
              onChange={(e) =>
                setRegions((current) => (e.target.checked ? [...current, region] : current.filter((r) => r !== region)))
              }
            />
            <span>{t(`consent.region.${region}`)}</span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="pui-checkbox"
          checked={exemption}
          onChange={(e) => setExemption(e.target.checked)}
        />
        <span>
          <span>{t('consent.policy.exemption')}</span>
          <span className="ui-caption block">{t('consent.policy.exemptionHelp')}</span>
        </span>
      </label>
      <div>
        <Button onClick={() => void save()}>{t('consent.policy.save')}</Button>
      </div>
      {saved && <p role="status">{t('consent.policy.saved')}</p>}
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
    </Card>
  );
}
