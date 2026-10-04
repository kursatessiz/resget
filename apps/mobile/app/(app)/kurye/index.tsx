import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import type { DeliveryTripDTO } from '@resget/shared';
import { Body, Button, Caption, Card, Notice, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { lastLocationSentAt, requestLocationPermission, startTracking, stopTracking } from '@/lib/location-tracker';
import { useSession } from '@/state/session';

/** The courier's trips (docs/SIPARIS_VE_SEVK.md, section 7); location sharing runs while one is in progress. */
export default function CourierTrips() {
  const t = useT();
  const router = useRouter();
  const { api, membership } = useSession();
  const [trips, setTrips] = useState<DeliveryTripDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<boolean | null>(null);

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

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), 10_000);
      return () => clearInterval(timer);
    }, [load]),
  );

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
    </Screen>
  );
}
