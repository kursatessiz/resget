'use client';

import { useEffect, useState } from 'react';
import { DELIVERY_BANDS_MAX, DeliveryZoneSchema, majorAmountText, parseMajorAmount } from '@resget/shared';
import type { DeliveryZone, DeliveryZoneDTO, RestaurantSettingsDTO } from '@resget/shared';
import { Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

interface BandText {
  upToKm: string;
  fee: string;
}

const kmText = (meters: number) => String(meters / 1000);
const metersOf = (text: string) => Math.round(Number(text.replace(',', '.')) * 1000);

/**
 * The delivery zone (docs/VITRIN.md, "Teslimat bölgesi"): radius, minimum
 * basket and, for own couriers, a fee by distance band. Shown only while the
 * delivery_zones module is on for the restaurant.
 */
export function DeliveryZoneEditor({
  restaurantId,
  locale,
  canManage,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
}) {
  const t = useT(locale);
  const [currency, setCurrency] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState('5');
  const [minBasket, setMinBasket] = useState('0');
  const [bands, setBands] = useState<BandText[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const path = `restaurants/${restaurantId}/delivery-zone`;

  const show = (zone: DeliveryZone | null, code: string) => {
    if (!zone) return;
    setRadiusKm(kmText(zone.radiusMeters));
    setMinBasket(majorAmountText(zone.minBasketMinor, code));
    setBands(zone.bands.map((b) => ({ upToKm: kmText(b.upToMeters), fee: majorAmountText(b.feeMinor, code) })));
  };

  useEffect(() => {
    Promise.all([bffJson<RestaurantSettingsDTO>(`restaurants/${restaurantId}`), bffJson<DeliveryZoneDTO>(path)])
      .then(([settings, dto]) => {
        setCurrency(settings.currency);
        show(dto.zone, settings.currency);
      })
      .catch(() => setMessage(t('common.error.network')));
    // Loaded once; saving refreshes from the response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, restaurantId]);

  if (!currency) return message ? <p role="alert">{message}</p> : null;

  const draft = {
    radiusMeters: metersOf(radiusKm),
    minBasketMinor: parseMajorAmount(minBasket, currency) ?? -1,
    bands: bands.map((b) => ({ upToMeters: metersOf(b.upToKm), feeMinor: parseMajorAmount(b.fee, currency) ?? -1 })),
  };
  const parsed = DeliveryZoneSchema.safeParse(draft);

  const save = async (zone: DeliveryZone | null) => {
    setBusy(true);
    setMessage(null);
    try {
      const dto = await bffJson<DeliveryZoneDTO>(path, { method: 'PUT', body: JSON.stringify({ zone }) });
      show(dto.zone, currency);
      if (!dto.zone) {
        setRadiusKm('5');
        setMinBasket('0');
        setBands([]);
      }
      setMessage(t('settings.zone.saved'));
    } catch (err) {
      setMessage(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('settings.zone.title')} aria-label={t('settings.zone.title')}>
      <div className="flex flex-col gap-4">
        <p className="ui-caption">{t('settings.zone.intro')}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <TextField
            id="zone-radius"
            label={t('settings.zone.radius')}
            inputMode="decimal"
            value={radiusKm}
            disabled={!canManage}
            onChange={(event) => setRadiusKm(event.target.value)}
          />
          <TextField
            id="zone-min-basket"
            label={t('settings.zone.minBasket', { currency })}
            help={t('settings.zone.minBasketHelp')}
            inputMode="decimal"
            value={minBasket}
            disabled={!canManage}
            onChange={(event) => setMinBasket(event.target.value)}
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="ui-heading">{t('settings.zone.bands')}</legend>
          {bands.map((band, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2" data-zone-band={index}>
              <TextField
                id={`zone-band-${index}-km`}
                label={t('settings.zone.bandUpTo')}
                inputMode="decimal"
                value={band.upToKm}
                disabled={!canManage}
                onChange={(event) =>
                  setBands(bands.map((b, i) => (i === index ? { ...b, upToKm: event.target.value } : b)))
                }
              />
              <TextField
                id={`zone-band-${index}-fee`}
                label={t('settings.zone.bandFee', { currency })}
                inputMode="decimal"
                value={band.fee}
                disabled={!canManage}
                onChange={(event) =>
                  setBands(bands.map((b, i) => (i === index ? { ...b, fee: event.target.value } : b)))
                }
              />
              {canManage && (
                <Button variant="outline" tone="muted" onClick={() => setBands(bands.filter((_, i) => i !== index))}>
                  {t('settings.zone.removeBand')}
                </Button>
              )}
            </div>
          ))}
          {canManage && bands.length < DELIVERY_BANDS_MAX && (
            <div>
              <Button variant="soft" onClick={() => setBands([...bands, { upToKm: radiusKm, fee: '0' }])}>
                {t('settings.zone.addBand')}
              </Button>
            </div>
          )}
        </fieldset>
        {!parsed.success && <p role="alert">{t('settings.zone.invalid')}</p>}
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => parsed.success && void save(parsed.data)} disabled={busy || !parsed.success}>
              {t('settings.zone.save')}
            </Button>
            <Button variant="outline" tone="muted" onClick={() => void save(null)} disabled={busy}>
              {t('settings.zone.clear')}
            </Button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </Card>
  );
}
