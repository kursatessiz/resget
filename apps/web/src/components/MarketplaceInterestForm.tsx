'use client';

import { useState } from 'react';
import type { MarketplaceInterestResultDTO } from '@resget/shared';
import { Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** A visitor whose district is not open yet leaves a signal; nothing identifying is collected (docs/VITRIN.md). */
export function MarketplaceInterestForm({ countryCode, locale }: { countryCode: string; locale: string }) {
  const t = useT(locale);
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [result, setResult] = useState<MarketplaceInterestResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await bffJson<MarketplaceInterestResultDTO>('public/marketplace/interest', {
          method: 'POST',
          body: JSON.stringify({ countryCode, city: city.trim(), district: district.trim() }),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('shop.marketplace.interest.title')} aria-label={t('shop.marketplace.interest.title')}>
      <p className="ui-text-muted">{t('shop.marketplace.interest.intro')}</p>
      {result ? (
        <p role="status">
          {result.launched ? t('shop.marketplace.interest.launched') : t('shop.marketplace.interest.sent')}
        </p>
      ) : (
        <form
          className="flex flex-col gap-3 md:flex-row md:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <TextField
            label={t('shop.marketplace.interest.city')}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            maxLength={80}
          />
          <TextField
            label={t('shop.marketplace.interest.district')}
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            maxLength={80}
          />
          <Button
            type="submit"
            variant="outline"
            tone="muted"
            disabled={busy || city.trim().length < 2 || district.trim().length < 2}
          >
            {t('shop.marketplace.interest.send')}
          </Button>
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
