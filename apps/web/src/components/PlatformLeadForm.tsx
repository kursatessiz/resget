'use client';

import { useState } from 'react';
import { PhoneSchema } from '@resget/shared';
import { Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** "Tell me more" on the platform site: a lead in the platform's own pipeline (docs/ATIF.md). */
export function PlatformLeadForm({ locale }: { locale: string }) {
  const t = useT(locale);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phoneValid = PhoneSchema.safeParse(phone).success;
  const ready = fullName.trim().length >= 2 && restaurantName.trim().length >= 2 && phoneValid && privacy;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await bffJson<void>('public/platform/leads', {
        method: 'POST',
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone,
          restaurantName: restaurantName.trim(),
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(district.trim() ? { district: district.trim() } : {}),
          privacyAccepted: true,
        }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('attribution.lead.title')} aria-label={t('attribution.lead.title')}>
      <p className="ui-text-muted">{t('attribution.lead.intro')}</p>
      {sent ? (
        <p role="status">{t('attribution.lead.sent')}</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) void send();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={t('attribution.lead.fullName')}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={120}
              autoComplete="name"
            />
            <TextField
              label={t('attribution.lead.phone')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              error={phone && !phoneValid ? t('attribution.lead.phoneInvalid') : undefined}
            />
            <TextField
              label={t('attribution.lead.restaurantName')}
              value={restaurantName}
              onChange={(e) => setRestaurantName(e.target.value)}
              maxLength={120}
              autoComplete="organization"
            />
            <TextField
              label={t('attribution.lead.city')}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={80}
            />
            <TextField
              label={t('attribution.lead.district')}
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              maxLength={80}
            />
          </div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="pui-checkbox"
              checked={privacy}
              onChange={(e) => setPrivacy(e.target.checked)}
            />
            <span className="ui-caption">{t('attribution.lead.privacy')}</span>
          </label>
          <div>
            <Button type="submit" disabled={busy || !ready}>
              {t('attribution.lead.send')}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
    </Card>
  );
}
