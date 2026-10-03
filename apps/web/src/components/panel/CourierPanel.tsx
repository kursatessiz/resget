'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type { CourierOverviewDTO } from '@resget/shared';
import { Badge, Button, Card, LinkButton, SelectField } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const REQUEST_TONE: Record<CourierOverviewDTO['requests'][number]['status'], UiTone> = {
  QUOTED: 'muted',
  REQUESTED: 'warn',
  ASSIGNED: 'warn',
  PICKED_UP: 'warn',
  DELIVERED: 'success',
  CANCELLED: 'muted',
  FAILED: 'error',
};

/** Courier screen: own couriers, the contracted network and its recent requests (docs/PANEL.md). */
export function CourierPanel({
  restaurantId,
  slug,
  locale,
  canInvite,
  canEditSettings,
}: {
  restaurantId: string;
  slug: string;
  locale: string;
  canInvite: boolean;
  canEditSettings: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/courier`;
  const [data, setData] = useState<CourierOverviewDTO | null>(null);
  const [providerId, setProviderId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const apply = useCallback((dto: CourierOverviewDTO) => {
    setData(dto);
    setProviderId(dto.selectedProviderId ?? '');
  }, []);

  useEffect(() => {
    bffJson<CourierOverviewDTO>(`${base}/overview`).then(apply).catch(fail);
  }, [base, apply, fail]);

  const saveProvider = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      apply(
        await bffJson<CourierOverviewDTO>(`${base}/provider`, {
          method: 'PUT',
          body: JSON.stringify({ courierProviderId: providerId || null }),
        }),
      );
      setNotice(t('common.saved'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('courier.title')}</h1>
        <p className="ui-text-muted">{t('courier.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {notice && <p className="pui-alert pui-success">{notice}</p>}

      {data && (
        <>
          <Card
            title={t('courier.today.title')}
            aside={
              <Badge tone="muted">{t('courier.mode.current', { mode: t(`courier.mode.${data.deliveryMode}`) })}</Badge>
            }
          >
            <p>
              {t('courier.today.trips', { count: data.today.trips })},{' '}
              {t('courier.today.delivered', { count: data.today.delivered })},{' '}
              {t('courier.today.failed', { count: data.today.failed })}
            </p>
            {canEditSettings && (
              <div>
                <LinkButton href={`/panel/${slug}/ayarlar`} variant="outline" tone="muted">
                  {t('courier.openSettings')}
                </LinkButton>
              </div>
            )}
          </Card>

          <Card title={t('courier.own.title')}>
            {data.couriers.length === 0 && <p className="ui-text-muted">{t('courier.own.empty')}</p>}
            {data.couriers.length > 0 && (
              <ul className="flex flex-col gap-2">
                {data.couriers.map((courier) => (
                  <li key={courier.membershipId} className="flex items-center justify-between gap-2">
                    <span>{courier.fullName}</span>
                    <Badge tone={courier.activeTripId ? 'warn' : 'muted'}>
                      {courier.activeTripId ? t('courier.own.onTrip') : t('courier.own.idle')}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {canInvite && (
              <div>
                <LinkButton href={`/panel/${slug}/personel`} variant="outline" tone="muted">
                  {t('courier.own.invite')}
                </LinkButton>
              </div>
            )}
          </Card>

          <Card title={t('courier.network.title')}>
            <p className="ui-text-muted">{t('courier.network.help')}</p>
            {data.providers.length === 0 && <p className="ui-caption">{t('courier.network.empty')}</p>}
            {data.providers.length > 0 && (
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <SelectField
                  label={t('courier.network.provider')}
                  value={providerId}
                  onChange={(e) => setProviderId(e.target.value)}
                >
                  <option value="">{t('courier.network.none')}</option>
                  {data.providers.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.isActive}>
                      {p.name}
                    </option>
                  ))}
                </SelectField>
                <Button onClick={saveProvider} disabled={busy}>
                  {t('courier.network.save')}
                </Button>
              </div>
            )}
          </Card>

          <Card title={t('courier.requests.title')}>
            {data.requests.length === 0 && <p className="ui-text-muted">{t('courier.requests.empty')}</p>}
            {data.requests.length > 0 && (
              <ul className="flex flex-col gap-2">
                {data.requests.map((request) => (
                  <li key={request.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {t('orders.shortCode', { code: request.orderShortCode })}: {request.providerName},{' '}
                      {formatMoney(
                        { amountMinor: request.finalFeeMinor ?? request.quoteFeeMinor, currency: request.currency },
                        locale,
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="ui-caption">{when(request.createdAt)}</span>
                      <Badge tone={REQUEST_TONE[request.status]}>
                        {t(`courier.requests.status.${request.status}`)}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
