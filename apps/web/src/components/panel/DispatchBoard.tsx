'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatMoney, reorderStopIds } from '@resget/shared';
import type {
  CourierSummaryDTO,
  DeliveryStopDTO,
  DeliveryTripDTO,
  DispatchBoardDTO,
  OrderSummaryDTO,
  RealtimeEvent,
  StopSequenceModeValue,
} from '@resget/shared';
import { LiveMap } from '@/components/LiveMap';
import { Badge, Button, SelectField, TextField } from '@/components/ui';
import type { MapMarker, MapTilesConfig } from '@/lib/map';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson, useRealtime } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const ACTIVE_TRIP = new Set(['PLANNED', 'ASSIGNED', 'IN_PROGRESS']);
const ACTIVE_STOP = new Set(['PENDING', 'EN_ROUTE', 'ARRIVING']);
const TRIP_TONE: Record<string, UiTone> = {
  PLANNED: 'muted',
  ASSIGNED: 'theme',
  IN_PROGRESS: 'success',
  COMPLETED: 'muted',
  CANCELLED: 'error',
};
const STOP_TONE: Record<string, UiTone> = {
  PENDING: 'muted',
  EN_ROUTE: 'theme',
  ARRIVING: 'warn',
  DELIVERED: 'success',
  FAILED: 'error',
  REMOVED: 'muted',
};

function isUpcoming(order: OrderSummaryDTO): boolean {
  return (
    order.fulfillment === 'DELIVERY' && !order.activeTrip && ['PLACED', 'ACCEPTED', 'PREPARING'].includes(order.status)
  );
}
function isReady(order: OrderSummaryDTO): boolean {
  return order.fulfillment === 'DELIVERY' && !order.activeTrip && order.status === 'READY';
}

/**
 * The dispatch board (docs/SIPARIS_VE_SEVK.md): ready orders become trips,
 * trips get a courier and a stop order (by hand or the route optimiser) and
 * run stop by stop while courier positions and estimates stream in.
 */
export function DispatchBoard({
  restaurantId,
  locale,
  canManage,
  tiles,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
  tiles: MapTilesConfig;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/dispatch`;
  const [board, setBoard] = useState<DispatchBoardDTO | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [courierId, setCourierId] = useState('');
  const [mode, setMode] = useState<StopSequenceModeValue>('OPTIMIZED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failing, setFailing] = useState<{ tripId: string; stopId: string; reason: string } | null>(null);
  /** The stop being dragged and the one under the pointer; buttons remain for keyboard users. */
  const [dragging, setDragging] = useState<{ tripId: string; stopId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const time = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale]);
  const km = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale]);

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));

  // Everyone who shared a position and every routable stop of an active trip, redrawn as events arrive.
  const markers = useMemo<MapMarker[]>(() => {
    if (!board) return [];
    const list: MapMarker[] = [];
    for (const c of board.couriers) {
      if (c.position) {
        list.push({
          id: `courier-${c.membershipId}`,
          lat: c.position.lat,
          lng: c.position.lng,
          label: c.fullName,
          kind: 'courier',
        });
      }
    }
    for (const trip of board.activeTrips) {
      for (const stop of trip.stops) {
        if (!stop.point || stop.status === 'REMOVED') continue;
        list.push({
          id: `stop-${stop.id}`,
          lat: stop.point.lat,
          lng: stop.point.lng,
          label: t('dispatch.map.stop', { sequence: stop.sequence, code: stop.orderShortCode }),
          kind:
            stop.status === 'DELIVERED' || stop.status === 'FAILED'
              ? 'stop-done'
              : stop.status === 'ARRIVING' || stop.status === 'EN_ROUTE'
                ? 'stop-active'
                : 'stop',
        });
      }
    }
    return list;
  }, [board, t]);

  const load = useCallback(async () => {
    try {
      setBoard(await bffJson<DispatchBoardDTO>(`${base}/board`));
    } catch (err) {
      fail(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  const applyOrder = (order: OrderSummaryDTO) =>
    setBoard((current) => {
      if (!current) return current;
      const without = (list: OrderSummaryDTO[]) => list.filter((o) => o.id !== order.id);
      return {
        ...current,
        readyOrders: isReady(order) ? [...without(current.readyOrders), order] : without(current.readyOrders),
        upcomingOrders: isUpcoming(order)
          ? [...without(current.upcomingOrders), order]
          : without(current.upcomingOrders),
        activeTrips: current.activeTrips.map((trip) => ({
          ...trip,
          stops: trip.stops.map((s) => (s.orderId === order.id ? { ...s, orderStatus: order.status } : s)),
        })),
      };
    });

  const applyTrip = (trip: DeliveryTripDTO) =>
    setBoard((current) => {
      if (!current) return current;
      const others = current.activeTrips.filter((x) => x.id !== trip.id);
      const activeTrips = ACTIVE_TRIP.has(trip.status)
        ? [...others, trip].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        : others;
      const couriers = current.couriers.map((c) =>
        c.membershipId === trip.courier?.membershipId
          ? { ...c, activeTripId: trip.courier?.activeTripId ?? null, position: trip.courier?.position ?? c.position }
          : c.activeTripId === trip.id && !ACTIVE_TRIP.has(trip.status)
            ? { ...c, activeTripId: null }
            : c,
      );
      return { ...current, activeTrips, couriers };
    });

  const status = useRealtime(`${base}/events`, (event: RealtimeEvent) => {
    if (event.type === 'order.updated') applyOrder(event.order);
    else if (event.type === 'trip.updated') applyTrip(event.trip);
    else if (event.type === 'courier.location') {
      setBoard((current) => {
        if (!current) return current;
        return {
          ...current,
          couriers: current.couriers.map((c) =>
            c.membershipId === event.membershipId ? { ...c, position: event.position } : c,
          ),
          activeTrips: current.activeTrips.map((trip) =>
            trip.id !== event.tripId
              ? trip
              : {
                  ...trip,
                  courier: trip.courier ? { ...trip.courier, position: event.position } : trip.courier,
                  stops: trip.stops.map((s) => {
                    const eta = event.stops.find((e) => e.stopId === s.id);
                    return eta ? { ...s, distanceMeters: eta.distanceMeters, etaAt: eta.etaAt } : s;
                  }),
                },
          ),
        };
      });
    }
  });

  const act = async <T,>(work: () => Promise<T>, after?: (result: T) => void) => {
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      after?.(result);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const tripCall = (tripId: string, path: string, method = 'POST', body?: unknown) =>
    act(
      () =>
        bffJson<DeliveryTripDTO>(`${base}/trips/${tripId}${path}`, {
          method,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      applyTrip,
    );

  const createTrip = () =>
    act(
      () =>
        bffJson<DeliveryTripDTO>(`${base}/trips`, {
          method: 'POST',
          body: JSON.stringify({
            orderIds: [...selected],
            sequenceMode: mode,
            courierMembershipId: courierId || undefined,
          }),
        }),
      (trip) => {
        applyTrip(trip);
        setSelected(new Set());
        void load();
      },
    );

  const move = (trip: DeliveryTripDTO, stopId: string, direction: -1 | 1) => {
    const movable = trip.stops.filter((s) => ACTIVE_STOP.has(s.status)).map((s) => s.id);
    const index = movable.indexOf(stopId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= movable.length) return;
    [movable[index], movable[target]] = [movable[target], movable[index]];
    void tripCall(trip.id, '/sequence', 'PUT', { stopIds: movable });
  };

  const drop = (trip: DeliveryTripDTO, targetId: string) => {
    const moving = dragging;
    setDragging(null);
    setDropTarget(null);
    if (!moving || moving.tripId !== trip.id) return;
    const ids = trip.stops.filter((s) => ACTIVE_STOP.has(s.status)).map((s) => s.id);
    const next = reorderStopIds(ids, moving.stopId, targetId);
    if (next.every((id, i) => id === ids[i])) return;
    void tripCall(trip.id, '/sequence', 'PUT', { stopIds: next });
  };

  if (!board) return <p className="ui-text-muted">{error ?? t('common.loading')}</p>;

  const courierName = (c: CourierSummaryDTO) => c.fullName;
  const stopLine = (stop: DeliveryStopDTO) => (
    <>
      <Badge tone={STOP_TONE[stop.status] ?? 'muted'}>{t(`dispatch.stop.status.${stop.status}`)}</Badge>
      <span className="ui-heading">{t('orders.shortCode', { code: stop.orderShortCode })}</span>
      {stop.address && <span className="ui-caption">{stop.address.addressLine}</span>}
      {stop.distanceMeters !== null && (
        <span className="ui-caption">{t('dispatch.distance', { km: km.format(stop.distanceMeters / 1000) })}</span>
      )}
      {stop.etaAt && (
        <span className="ui-caption">{t('dispatch.eta', { time: time.format(new Date(stop.etaAt)) })}</span>
      )}
      {stop.point === null && <span className="ui-caption">{t('dispatch.unroutableStop')}</span>}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="ui-title">{t('dispatch.title')}</h1>
        <Badge tone={status === 'live' ? 'success' : 'warn'}>
          {status === 'live' ? t('dispatch.live') : t('dispatch.reconnecting')}
        </Badge>
      </header>
      {error && (
        <p role="alert" className="pui-badge pui-soft pui-error">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-2" aria-label={t('dispatch.map')}>
        <h2 className="ui-heading">{t('dispatch.map')}</h2>
        {markers.length === 0 ? (
          <p className="ui-caption">{t('dispatch.map.empty')}</p>
        ) : (
          <LiveMap tiles={tiles} markers={markers} label={t('dispatch.map')} height={320} />
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="flex flex-col gap-3" aria-label={t('dispatch.readyOrders')}>
          <h2 className="ui-heading flex items-center gap-2">
            {t('dispatch.readyOrders')}
            <Badge>{board.readyOrders.length}</Badge>
          </h2>
          {board.readyOrders.length === 0 && <p className="ui-caption">{t('dispatch.noReadyOrders')}</p>}
          <ul className="flex flex-col gap-2">
            {board.readyOrders.map((order) => (
              <li key={order.id} className="pui-card">
                <label className="pui-card-content flex items-start gap-3">
                  {canManage && (
                    <input
                      type="checkbox"
                      className="pui-checkbox"
                      checked={selected.has(order.id)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(order.id);
                        else next.delete(order.id);
                        setSelected(next);
                      }}
                      aria-label={t('orders.shortCode', { code: order.shortCode })}
                    />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="ui-heading">{t('orders.shortCode', { code: order.shortCode })}</span>
                    <span className="ui-caption">{order.address?.addressLine}</span>
                    <span className="ui-caption">
                      {order.customer.fullName ?? ''} /{' '}
                      {formatMoney({ amountMinor: order.chargedToCustomerMinor, currency: order.currency }, locale)}
                      {order.payment.dueMinor > 0
                        ? ` / ${t('orders.paymentDue', { amount: formatMoney({ amountMinor: order.payment.dueMinor, currency: order.currency }, locale) })}`
                        : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {canManage && board.readyOrders.length > 0 && (
            <div className="pui-card">
              <div className="pui-card-content flex flex-col gap-3">
                <span className="ui-heading">{t('dispatch.createTrip')}</span>
                <p className="ui-caption">
                  {selected.size > 0
                    ? t('dispatch.selectedCount', { count: selected.size })
                    : t('dispatch.selectOrders')}
                </p>
                <SelectField
                  id="courier"
                  label={t('dispatch.courierSelect')}
                  value={courierId}
                  onChange={(e) => setCourierId(e.target.value)}
                >
                  <option value="">{t('dispatch.noCourierYet')}</option>
                  {board.couriers.map((c) => (
                    <option key={c.membershipId} value={c.membershipId}>
                      {courierName(c)}
                      {c.activeTripId ? ` (${t('dispatch.onTrip')})` : ''}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  id="mode"
                  label={t('dispatch.reorder')}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as StopSequenceModeValue)}
                >
                  <option value="OPTIMIZED">{t('dispatch.sequence.OPTIMIZED')}</option>
                  <option value="MANUAL">{t('dispatch.sequence.MANUAL')}</option>
                </SelectField>
                <Button
                  onClick={() => void createTrip()}
                  disabled={busy || selected.size === 0 || selected.size > board.settings.maxStopsPerTrip}
                >
                  {t('dispatch.createTrip')}
                </Button>
              </div>
            </div>
          )}
          {board.upcomingOrders.length > 0 && (
            <details className="pui-accordion">
              <summary className="ui-heading">
                {t('dispatch.upcomingOrders')} ({board.upcomingOrders.length})
              </summary>
              <ul className="flex flex-col gap-1 pt-2">
                {board.upcomingOrders.map((order) => (
                  <li key={order.id} className="ui-caption">
                    {t('orders.shortCode', { code: order.shortCode })} - {t(`orders.status.${order.status}`)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="flex flex-col gap-3" aria-label={t('dispatch.activeTrips')}>
          <h2 className="ui-heading flex items-center gap-2">
            {t('dispatch.activeTrips')}
            <Badge>{board.activeTrips.length}</Badge>
          </h2>
          {board.activeTrips.length === 0 && <p className="ui-caption">{t('dispatch.noActiveTrips')}</p>}
          {board.activeTrips.map((trip) => {
            const movable = trip.stops.filter((s) => ACTIVE_STOP.has(s.status));
            return (
              <article key={trip.id} className="pui-card" data-trip-id={trip.id}>
                <div className="pui-card-content flex flex-col gap-3">
                  <header className="flex flex-wrap items-center justify-between gap-2">
                    <span className="ui-heading">
                      {t('dispatch.tripTitle', { code: trip.id.slice(-6).toUpperCase() })}
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <Badge tone={TRIP_TONE[trip.status]}>{t(`dispatch.trip.status.${trip.status}`)}</Badge>
                      <Badge>{t(`dispatch.sequence.${trip.sequenceMode}`)}</Badge>
                    </span>
                  </header>
                  <p className="ui-caption">
                    {trip.courier ? trip.courier.fullName : t('dispatch.noCourierYet')}
                    {trip.plannedDistanceMeters !== null && trip.plannedDurationSeconds !== null
                      ? ` / ${t('dispatch.plannedRoute', { km: km.format(trip.plannedDistanceMeters / 1000), minutes: Math.round(trip.plannedDurationSeconds / 60) })}`
                      : ''}
                  </p>
                  {canManage && movable.length > 1 && <p className="ui-caption">{t('dispatch.dragHint')}</p>}
                  <ol className="pui-timeline">
                    {trip.stops.map((stop) => {
                      const draggable = canManage && !busy && movable.length > 1 && ACTIVE_STOP.has(stop.status);
                      return (
                        <li
                          key={stop.id}
                          className={`pui-checkpoint${draggable ? ' cursor-grab' : ''}`}
                          data-stop-code={stop.orderShortCode}
                          draggable={draggable}
                          onDragStart={(event) => {
                            if (!draggable) return;
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', stop.id);
                            setDragging({ tripId: trip.id, stopId: stop.id });
                          }}
                          onDragOver={(event) => {
                            if (!draggable || dragging?.tripId !== trip.id) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            if (dropTarget !== stop.id) setDropTarget(stop.id);
                          }}
                          onDragLeave={() => {
                            if (dropTarget === stop.id) setDropTarget(null);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            drop(trip, stop.id);
                          }}
                          onDragEnd={() => {
                            setDragging(null);
                            setDropTarget(null);
                          }}
                        >
                          <span
                            className={`pui-checkpoint-icon ${
                              dropTarget === stop.id && dragging?.stopId !== stop.id
                                ? 'pui-soft pui-theme'
                                : ACTIVE_STOP.has(stop.status)
                                  ? 'pui-outline pui-muted'
                                  : 'pui-solid pui-theme'
                            }`}
                          >
                            {stop.sequence}
                          </span>
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-2">{stopLine(stop)}</div>
                            {canManage && ACTIVE_STOP.has(stop.status) && (
                              <div className="flex flex-wrap gap-1">
                                {movable.length > 1 && (
                                  <>
                                    <Button
                                      variant="link"
                                      tone="muted"
                                      onClick={() => move(trip, stop.id, -1)}
                                      disabled={busy}
                                    >
                                      {t('dispatch.moveUp')}
                                    </Button>
                                    <Button
                                      variant="link"
                                      tone="muted"
                                      onClick={() => move(trip, stop.id, 1)}
                                      disabled={busy}
                                    >
                                      {t('dispatch.moveDown')}
                                    </Button>
                                  </>
                                )}
                                {trip.status === 'IN_PROGRESS' && (
                                  <>
                                    <Button
                                      variant="soft"
                                      tone="success"
                                      onClick={() => void tripCall(trip.id, `/stops/${stop.id}/deliver`)}
                                      disabled={busy}
                                    >
                                      {t('dispatch.deliver')}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      tone="error"
                                      onClick={() => setFailing({ tripId: trip.id, stopId: stop.id, reason: '' })}
                                      disabled={busy}
                                    >
                                      {t('dispatch.fail')}
                                    </Button>
                                  </>
                                )}
                                {trip.status !== 'IN_PROGRESS' && (
                                  <Button
                                    variant="link"
                                    tone="error"
                                    onClick={() => void tripCall(trip.id, `/stops/${stop.id}`, 'DELETE')}
                                    disabled={busy}
                                  >
                                    {t('dispatch.removeStop')}
                                  </Button>
                                )}
                              </div>
                            )}
                            {failing && failing.stopId === stop.id && (
                              <div className="flex flex-col gap-2">
                                <TextField
                                  id={`fail-${stop.id}`}
                                  label={t('dispatch.failReason')}
                                  value={failing.reason}
                                  onChange={(e) => setFailing({ ...failing, reason: e.target.value })}
                                />
                                <div className="flex gap-2">
                                  <Button
                                    tone="error"
                                    disabled={busy || failing.reason.trim().length < 2}
                                    onClick={() => {
                                      void tripCall(trip.id, `/stops/${stop.id}/fail`, 'POST', {
                                        reason: failing.reason.trim(),
                                      });
                                      setFailing(null);
                                    }}
                                  >
                                    {t('dispatch.fail')}
                                  </Button>
                                  <Button variant="outline" tone="muted" onClick={() => setFailing(null)}>
                                    {t('common.cancel')}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  {canManage && (
                    <div className="flex flex-wrap items-end gap-2">
                      {trip.status !== 'IN_PROGRESS' && (
                        <SelectField
                          id={`courier-${trip.id}`}
                          label={t('dispatch.assignCourier')}
                          value={trip.courier?.membershipId ?? ''}
                          onChange={(e) =>
                            e.target.value &&
                            void tripCall(trip.id, '/courier', 'PUT', { courierMembershipId: e.target.value })
                          }
                        >
                          <option value="">{t('dispatch.noCourierYet')}</option>
                          {board.couriers.map((c) => (
                            <option key={c.membershipId} value={c.membershipId}>
                              {courierName(c)}
                            </option>
                          ))}
                        </SelectField>
                      )}
                      {movable.length > 1 && (
                        <Button
                          variant="outline"
                          tone="muted"
                          onClick={() => void tripCall(trip.id, '/optimize')}
                          disabled={busy}
                        >
                          {t('dispatch.optimize')}
                        </Button>
                      )}
                      {trip.status === 'ASSIGNED' && !trip.pickedUpAt && (
                        <Button
                          variant="soft"
                          onClick={() => void tripCall(trip.id, '/pickup')}
                          disabled={busy}
                          title={t('dispatch.onBehalf')}
                        >
                          {t('dispatch.pickup')}
                        </Button>
                      )}
                      {trip.status === 'ASSIGNED' && (
                        <Button
                          onClick={() => void tripCall(trip.id, '/start')}
                          disabled={busy}
                          title={t('dispatch.onBehalf')}
                        >
                          {t('dispatch.start')}
                        </Button>
                      )}
                      <Button
                        variant="link"
                        tone="error"
                        onClick={() => void tripCall(trip.id, '/cancel', 'POST', {})}
                        disabled={busy}
                        title={t('dispatch.cancelTripWarning')}
                      >
                        {t('dispatch.cancelTrip')}
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        <section className="flex flex-col gap-3" aria-label={t('dispatch.couriers')}>
          <h2 className="ui-heading flex items-center gap-2">
            {t('dispatch.couriers')}
            <Badge>{board.couriers.length}</Badge>
          </h2>
          {board.couriers.length === 0 && <p className="ui-caption">{t('dispatch.noCouriers')}</p>}
          <ul className="pui-list">
            {board.couriers.map((c) => (
              <li key={c.membershipId} className="pui-list-item flex flex-col gap-1">
                <span className="flex items-center justify-between gap-2">
                  <span>{courierName(c)}</span>
                  <Badge tone={c.activeTripId ? 'success' : 'muted'}>
                    {c.activeTripId ? t('dispatch.onTrip') : t('dispatch.idle')}
                  </Badge>
                </span>
                <span className="ui-caption">
                  {c.position
                    ? t('dispatch.lastSeen', { time: time.format(new Date(c.position.recordedAt)) })
                    : t('dispatch.noPosition')}
                  {c.position && (
                    <>
                      {' '}
                      <a
                        className="pui-link pui-theme"
                        href={`https://www.google.com/maps?q=${c.position.lat},${c.position.lng}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('tracking.openMap')}
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
