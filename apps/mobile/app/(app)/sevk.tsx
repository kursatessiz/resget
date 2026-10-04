import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { CourierSummaryDTO, DeliveryTripDTO, DispatchBoardDTO, OrderSummaryDTO } from '@resget/shared';
import { MapPanel, useInAppMap } from '@/components/map-panel';
import type { MapPin } from '@/components/map-panel';
import { Body, Button, Caption, Card, Notice, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { isTabletWidth, pruneSelection, sortCouriers, toggleSelection, tripActions } from '@/lib/dispatch';
import { deviceLocale, useT } from '@/lib/i18n';
import { dispatchMapModel } from '@/lib/maps';
import type { DispatchStopState } from '@/lib/maps';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme';

/** How often the board is re-read while the screen is open; the web board streams, the app polls (docs/MOBIL.md). */
const REFRESH_MS = 8000;

const STOP_TONE: Record<DispatchStopState, MapPin['tone']> = { waiting: 'outline', active: 'theme', done: 'success' };

/**
 * The restaurant's dispatch board on a tablet or a phone (docs/MOBIL.md,
 * docs/SIPARIS_VE_SEVK.md): ready orders become trips, trips get a courier
 * and the shortest route, and run while the couriers' positions come in.
 * Two panes from tablet width; stacked on a phone.
 */
export default function DispatchScreen() {
  const t = useT();
  const theme = useTheme();
  const locale = deviceLocale();
  const { width } = useWindowDimensions();
  const { api, membership } = useSession();
  const [board, setBoard] = useState<DispatchBoardDTO | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [courierId, setCourierId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const showMap = useInAppMap();
  const canManage = membership?.permissions.includes('dispatch.manage') ?? false;
  const base = membership ? `restaurants/${membership.restaurantId}/dispatch` : null;
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('mobile.error.network')),
    [t],
  );

  const load = useCallback(async () => {
    if (!base || !membership) return;
    try {
      const next = await api.request<DispatchBoardDTO>(`${base}/board`, { restaurantId: membership.restaurantId });
      setBoard(next);
      setSelected((current) => pruneSelection(current, next));
      setError(null);
    } catch (err) {
      fail(err);
    }
  }, [api, base, fail, membership]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  const act = async (path: string, method: 'POST' | 'PUT', body: unknown) => {
    if (!base || !membership) return;
    setBusy(true);
    setError(null);
    try {
      await api.request(`${base}/${path}`, { method, body, restaurantId: membership.restaurantId });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const createTrip = async () => {
    await act('trips', 'POST', {
      orderIds: selected,
      sequenceMode: 'OPTIMIZED',
      ...(courierId ? { courierMembershipId: courierId } : {}),
    });
    setSelected([]);
    setCourierId(null);
  };

  const couriers = board ? sortCouriers(board.couriers) : [];
  // Couriers sharing a position and the routable stops of active trips, as on the web board.
  const map = useMemo(() => {
    if (!board) return null;
    const model = dispatchMapModel(board);
    const pins: MapPin[] = [
      ...model.stops.map((s) => ({
        id: `stop-${s.stopId}`,
        point: s.point,
        title: t('dispatch.map.stop', { sequence: s.sequence, code: s.orderShortCode }),
        text: String(s.sequence),
        tone: STOP_TONE[s.state],
      })),
      ...model.couriers.map((c) => ({
        id: `courier-${c.membershipId}`,
        point: c.point,
        title: c.fullName,
        text: c.fullName.trim().charAt(0).toLocaleUpperCase(locale),
        tone: 'ink' as const,
      })),
    ];
    return { pins, region: model.region };
  }, [board, locale, t]);
  const maxStops = board?.settings.maxStopsPerTrip ?? 1;

  const readyPane = (
    <View style={{ gap: theme.spacing[4] }}>
      <Card title={t('dispatch.readyOrders')}>
        {board && board.readyOrders.length === 0 && <Caption>{t('dispatch.noReadyOrders')}</Caption>}
        {board?.readyOrders.map((order: OrderSummaryDTO) => {
          const index = selected.indexOf(order.id);
          return (
            <Pressable
              key={order.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: index >= 0, disabled: !canManage }}
              disabled={!canManage}
              onPress={() => setSelected((current) => toggleSelection(current, order.id, maxStops))}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: theme.spacing[3],
                borderRadius: theme.radii.sm,
                borderWidth: 1,
                borderColor: index >= 0 ? theme.colors.theme : theme.colors.border,
              }}
            >
              <Text style={{ color: theme.colors.text, fontSize: theme.typography.size.md }}>
                {t('orders.shortCode', { code: order.shortCode })}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: theme.typography.size.sm }}>
                {index >= 0 ? String(index + 1) : time.format(new Date(order.placedAt))}
              </Text>
            </Pressable>
          );
        })}
        {canManage && selected.length > 0 && (
          <>
            <Caption>{t('dispatch.selectedCount', { count: selected.length })}</Caption>
            <Caption>{t('dispatch.courierSelect')}</Caption>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2] }}>
              <Button
                label={t('dispatch.noCourierYet')}
                variant={courierId === null ? 'solid' : 'outline'}
                tone={courierId === null ? 'theme' : 'muted'}
                onPress={() => setCourierId(null)}
              />
              {couriers.map((c) => (
                <Button
                  key={c.membershipId}
                  label={c.fullName}
                  variant={courierId === c.membershipId ? 'solid' : 'outline'}
                  tone={courierId === c.membershipId ? 'theme' : 'muted'}
                  onPress={() => setCourierId(c.membershipId)}
                />
              ))}
            </View>
            <Button label={t('dispatch.createTrip')} onPress={() => void createTrip()} busy={busy} />
          </>
        )}
      </Card>
      <Card title={t('dispatch.couriers')}>
        {board && couriers.length === 0 && <Caption>{t('dispatch.noCouriers')}</Caption>}
        {couriers.map((c: CourierSummaryDTO) => (
          <View key={c.membershipId} style={{ gap: theme.spacing[1] }}>
            <Body>
              {c.fullName}, {c.activeTripId ? t('dispatch.onTrip') : t('dispatch.idle')}
            </Body>
            <Caption>
              {c.position
                ? t('dispatch.lastSeen', { time: time.format(new Date(c.position.recordedAt)) })
                : t('dispatch.noPosition')}
            </Caption>
          </View>
        ))}
      </Card>
    </View>
  );

  const mapPane =
    showMap && map ? (
      map.pins.length > 0 ? (
        <MapPanel pins={map.pins} region={map.region} label={t('dispatch.map')} fitLabel={t('mobile.map.fit')} />
      ) : (
        <Caption>{t('dispatch.map.empty')}</Caption>
      )
    ) : null;

  const tripsPane = (
    <Card title={t('dispatch.activeTrips')}>
      {board && board.activeTrips.length === 0 && <Caption>{t('dispatch.noActiveTrips')}</Caption>}
      {board?.activeTrips.map((trip: DeliveryTripDTO) => {
        const actions = tripActions(trip, canManage);
        const stops = [...trip.stops].filter((s) => s.status !== 'REMOVED').sort((a, b) => a.sequence - b.sequence);
        return (
          <View
            key={trip.id}
            style={{
              gap: theme.spacing[2],
              paddingVertical: theme.spacing[3],
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
            }}
          >
            <Body>
              {t('dispatch.tripTitle', { code: trip.id.slice(-6).toUpperCase() })},{' '}
              {t(`dispatch.trip.status.${trip.status}`)}
            </Body>
            <Caption>
              {trip.courier ? trip.courier.fullName : t('dispatch.noCourierYet')},{' '}
              {t(`dispatch.sequence.${trip.sequenceMode}`)}
            </Caption>
            {stops.map((s) => (
              <Caption key={s.id}>
                {t('dispatch.stop', { sequence: s.sequence })}: {t('orders.shortCode', { code: s.orderShortCode })},{' '}
                {t(`dispatch.stop.status.${s.status}`)}
                {s.etaAt ? `, ${t('dispatch.eta', { time: time.format(new Date(s.etaAt)) })}` : ''}
              </Caption>
            ))}
            {actions.includes('assign') && assigning !== trip.id && (
              <Button
                label={t('dispatch.assignCourier')}
                variant="outline"
                tone="muted"
                onPress={() => setAssigning(trip.id)}
              />
            )}
            {assigning === trip.id && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2] }}>
                {couriers.map((c) => (
                  <Button
                    key={c.membershipId}
                    label={c.fullName}
                    variant="outline"
                    tone="theme"
                    busy={busy}
                    onPress={() => {
                      setAssigning(null);
                      void act(`trips/${trip.id}/courier`, 'PUT', { courierMembershipId: c.membershipId });
                    }}
                  />
                ))}
              </View>
            )}
            {actions.includes('optimize') && (
              <Button
                label={t('dispatch.optimize')}
                variant="outline"
                tone="muted"
                busy={busy}
                onPress={() => void act(`trips/${trip.id}/optimize`, 'POST', {})}
              />
            )}
            {actions.includes('cancel') && (
              <>
                <Caption>{t('dispatch.cancelTripWarning')}</Caption>
                <Button
                  label={t('dispatch.cancelTrip')}
                  variant="outline"
                  tone="warn"
                  busy={busy}
                  onPress={() => void act(`trips/${trip.id}/cancel`, 'POST', {})}
                />
              </>
            )}
          </View>
        );
      })}
    </Card>
  );

  return (
    <Screen>
      <Title>{t('dispatch.title')}</Title>
      {error && <Notice tone="error">{error}</Notice>}
      {isTabletWidth(width) ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing[4], alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>{readyPane}</View>
          <View style={{ flex: 1, gap: theme.spacing[4] }}>
            {mapPane}
            {tripsPane}
          </View>
        </View>
      ) : (
        <>
          {readyPane}
          {mapPane}
          {tripsPane}
        </>
      )}
    </Screen>
  );
}
