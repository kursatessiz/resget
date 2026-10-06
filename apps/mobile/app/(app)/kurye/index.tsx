import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatMoney } from '@resget/shared';
import type { CourierTipsSummaryDTO, DeliveryTripDTO } from '@resget/shared';
import { Body, Button, Caption, Card, Notice, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { deviceLocale, useT } from '@/lib/i18n';
import { lastLocationSentAt, requestLocationPermission, startTracking, stopTracking } from '@/lib/location-tracker';
import { useSession } from '@/state/session';

/**
 * The courier's trips (docs/SIPARIS_VE_SEVK.md, section 7); location sharing
 * runs while one is in progress. With the tips module on, the courier also
 * sees their own tips of the last 30 days (docs/BAHSIS.md).
 */
export default function CourierTrips() {
  const t = useT();
  const router = useRouter();
  const { api, membership } = useSession();
  const [trips, setTrips] = useState<DeliveryTripDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<boolean | null>(null);
  const [tips, setTips] = useState<CourierTipsSummaryDTO | null>(null);
  const locale = deviceLocale();
  const tipsOn = membership?.features.includes('courier_tips') ?? false;

  const load = useCallback(async () => {
    if (!membership) return;
    try {
      const list = await api.request<DeliveryTripDTO[]>(`restaurants/${membership.restaurantId}/courier/me/trips`, {
        restaurantId: membership.restaurantId,
      });
      setTrips(list);
      setError(null);
      // Positions flow only while a trip is on the road; the API refuses them otherwise anyway.
      if (list.some((trip) => trip.status === 'IN_PROGRESS')) {
        if (permission !== false) await startTracking(api, membership.restaurantId);
      } else {
        await stopTracking();
      }
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('mobile.error.network'));
    }
  }, [api, membership, permission, t]);

  useEffect(() => {
    requestLocationPermission().then(setPermission);
  }, []);

  /** Tips change only when one is paid; read on focus, not with the trips' polling. */
  const loadTips = useCallback(async () => {
    if (!membership || !tipsOn) return setTips(null);
    try {
      setTips(
        await api.request<CourierTipsSummaryDTO>(`restaurants/${membership.restaurantId}/tips/me`, {
          restaurantId: membership.restaurantId,
        }),
      );
    } catch {
      // The summary is a convenience; the trips above stay usable without it.
      setTips(null);
    }
  }, [api, membership, tipsOn]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void loadTips();
      const timer = setInterval(() => void load(), 10_000);
      return () => clearInterval(timer);
    }, [load, loadTips]),
  );
  const money = (amountMinor: number, currency: string) => formatMoney({ amountMinor, currency }, locale);

  const sentAt = lastLocationSentAt();
  return (
    <Screen>
      <Title>{t('mobile.courier.title')}</Title>
      {permission === false && <Notice tone="error">{t('mobile.location.denied')}</Notice>}
      {permission && <Caption>{t('mobile.location.on')}</Caption>}
      {sentAt && (
        <Caption>
          {t('mobile.location.sent', {
            time: new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(sentAt),
          })}
        </Caption>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {trips && trips.length === 0 && <Body muted>{t('mobile.courier.empty')}</Body>}
      {trips?.map((trip) => (
        <Card key={trip.id} title={t('mobile.courier.trip', { code: trip.id.slice(-6).toUpperCase() })}>
          <Body>
            {t(`mobile.courier.status.${trip.status}`)}, {t('mobile.courier.stops', { count: trip.stops.length })}
          </Body>
          <Button label={t('orders.open')} onPress={() => router.push(`/(app)/kurye/${trip.id}`)} />
        </Card>
      ))}
      {tips && (
        <Card title={t('tips.mine.title')}>
          <Caption>{t('tips.report.lastDays', { count: tips.days })}</Caption>
          {tips.totals.count === 0 ? (
            <Body muted>{t('tips.report.empty')}</Body>
          ) : (
            <Body>
              {t('tips.report.totals', {
                count: tips.totals.count,
                gross: money(tips.totals.grossMinor, tips.currency),
                fee: money(tips.totals.feeMinor, tips.currency),
                net: money(tips.totals.netMinor, tips.currency),
              })}
            </Body>
          )}
          {tips.recent
            .filter((tip) => tip.status === 'CAPTURED')
            .map((tip) => (
              <Caption key={tip.id}>
                {t('tips.mine.line', { code: tip.orderShortCode, net: money(tip.netMinor, tip.currency) })}
              </Caption>
            ))}
        </Card>
      )}
    </Screen>
  );
}
