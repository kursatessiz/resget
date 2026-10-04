import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { DeliveryStopDTO, DeliveryTripDTO } from '@resget/shared';
import { useInAppMap } from '@/components/map-panel';
import { TripMap } from '@/components/trip-map';
import { Body, Button, Caption, Card, Field, Notice, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { startTracking, stopTracking } from '@/lib/location-tracker';
import { navigationUrl } from '@/lib/trip-map';
import { useNavigationApp } from '@/lib/use-navigation-app';
import { useSession } from '@/state/session';

type Action =
  | { kind: 'pickup' }
  | { kind: 'start' }
  | { kind: 'arrive'; stop: DeliveryStopDTO }
  | { kind: 'deliver'; stop: DeliveryStopDTO }
  | { kind: 'done' };

/** The one thing to do next: pick up, start, arrive at the current stop, deliver it, or nothing when the trip is over. */
function nextAction(trip: DeliveryTripDTO): Action {
  if (trip.status === 'ASSIGNED') return trip.pickedUpAt ? { kind: 'start' } : { kind: 'pickup' };
  if (trip.status === 'IN_PROGRESS') {
    const current = [...trip.stops]
      .sort((a, b) => a.sequence - b.sequence)
      .find((s) => s.status === 'PENDING' || s.status === 'EN_ROUTE' || s.status === 'ARRIVING');
    if (current)
      return current.status === 'ARRIVING' ? { kind: 'deliver', stop: current } : { kind: 'arrive', stop: current };
  }
  return { kind: 'done' };
}

/** Stops in order with the single action button and the trip map (docs/SIPARIS_VE_SEVK.md, section 7; docs/MOBIL.md). */
export default function TripScreen() {
  const t = useT();
  const router = useRouter();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const { api, membership } = useSession();
  const [trip, setTrip] = useState<DeliveryTripDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failing, setFailing] = useState<DeliveryStopDTO | null>(null);
  const [reason, setReason] = useState('');
  const showMap = useInAppMap();
  const navigation = useNavigationApp();
  const base = membership ? `restaurants/${membership.restaurantId}/courier/me/trips/${tripId}` : null;

  const load = useCallback(async () => {
    if (!base || !membership) return;
    try {
      setTrip(await api.request<DeliveryTripDTO>(base, { restaurantId: membership.restaurantId }));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('mobile.error.network'));
    }
  }, [api, base, membership, t]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const post = async (path: string, body?: unknown) => {
    if (!base || !membership) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.request<DeliveryTripDTO>(`${base}/${path}`, {
        method: 'POST',
        restaurantId: membership.restaurantId,
        body: body ?? {},
      });
      setTrip(next);
      if (next.status === 'IN_PROGRESS') await startTracking(api, membership.restaurantId);
      if (next.status === 'COMPLETED' || next.status === 'CANCELLED') {
        await stopTracking();
        router.back();
      }
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('mobile.error.network'));
    } finally {
      setBusy(false);
    }
  };

  const action = useMemo(() => (trip ? nextAction(trip) : null), [trip]);
  const stops = useMemo(() => (trip ? [...trip.stops].sort((a, b) => a.sequence - b.sequence) : []), [trip]);
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

  const run = () => {
    if (!action) return;
    switch (action.kind) {
      case 'pickup':
        return void post('pickup');
      case 'start':
        return void post('start');
      case 'arrive':
        return void post(`stops/${action.stop.id}/arrive`);
      case 'deliver':
        return void post(`stops/${action.stop.id}/deliver`);
      default:
        return undefined;
    }
  };
  const label = action
    ? action.kind === 'done'
      ? t('mobile.courier.action.done')
      : t(`mobile.courier.action.${action.kind}`)
    : '';

  return (
    <Screen>
      <Title>{t('mobile.courier.trip', { code: String(tripId).slice(-6).toUpperCase() })}</Title>
      {trip && (
        <Body muted>
          {trip.status === 'ASSIGNED' && trip.pickedUpAt
            ? t('mobile.courier.status.pickedUp')
            : t(`mobile.courier.status.${trip.status}`)}
        </Body>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {action && <Button label={label} onPress={run} busy={busy} disabled={action.kind === 'done'} big />}
      {action && (action.kind === 'arrive' || action.kind === 'deliver') && !failing && (
        <Button
          label={t('mobile.courier.action.fail')}
          onPress={() => setFailing(action.stop)}
          variant="outline"
          tone="warn"
        />
      )}
      {failing && (
        <Card title={t('mobile.courier.action.fail')}>
          <Field label={t('mobile.courier.failReason')} value={reason} onChangeText={setReason} maxLength={300} />
          <Button
            label={t('mobile.courier.failConfirm')}
            tone="warn"
            busy={busy}
            disabled={reason.trim().length < 2}
            onPress={() => {
              const stop = failing;
              setFailing(null);
              setReason('');
              void post(`stops/${stop.id}/fail`, { reason: reason.trim() });
            }}
          />
        </Card>
      )}
      {trip && showMap && <TripMap trip={trip} />}
      {stops.map((stop) => (
        <Card key={stop.id} title={t('mobile.courier.stop', { sequence: stop.sequence, code: stop.orderShortCode })}>
          <Body>{t(`mobile.courier.stopStatus.${stop.status}`)}</Body>
          {stop.address && (
            <Body>
              {stop.address.addressLine}, {stop.address.district} / {stop.address.city}
              {stop.address.note ? ` (${stop.address.note})` : ''}
            </Body>
          )}
          <Caption>
            {stop.distanceMeters !== null &&
              `${t('mobile.courier.distance', { km: (stop.distanceMeters / 1000).toFixed(1) })} `}
            {stop.etaAt && t('mobile.courier.eta', { time: time.format(new Date(stop.etaAt)) })}
          </Caption>
          {stop.address && (
            <Button
              label={t('mobile.courier.call')}
              variant="outline"
              tone="muted"
              onPress={() => void Linking.openURL(`tel:${stop.address!.contactPhone}`)}
            />
          )}
          {stop.point ? (
            <Button
              label={t('mobile.courier.navigateWith', { app: t(`mobile.courier.navApp.${navigation.app}`) })}
              variant="outline"
              tone="muted"
              onPress={() => void Linking.openURL(navigationUrl(navigation.app, stop.point!))}
            />
          ) : (
            <Caption>{t('mobile.courier.noPoint')}</Caption>
          )}
        </Card>
      ))}
    </Screen>
  );
}
