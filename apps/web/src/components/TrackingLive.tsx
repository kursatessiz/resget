'use client';

import { useEffect, useMemo, useState } from 'react';
import { BASE_LOCALE, BUNDLED_MESSAGES, createTranslator } from '@resget/shared';
import type { OrderTrackingDTO } from '@resget/shared';
import { Card, LinkButton } from '@/components/ui';
import { cx } from '@/components/ui/types';

type Step = 'placed' | 'accepted' | 'preparing' | 'ready' | 'onTheWay' | 'delivered' | 'pickedUp' | 'served';

const STEPS: Record<OrderTrackingDTO['fulfillment'], Step[]> = {
  DELIVERY: ['placed', 'accepted', 'preparing', 'ready', 'onTheWay', 'delivered'],
  PICKUP: ['placed', 'accepted', 'preparing', 'ready', 'pickedUp'],
  DINE_IN: ['placed', 'accepted', 'preparing', 'served'],
};

/** Index of the step a status has reached; -1 for a cancelled or rejected order. */
function stepIndex(status: OrderTrackingDTO['status'], fulfillment: OrderTrackingDTO['fulfillment']): number {
  const steps = STEPS[fulfillment];
  switch (status) {
    case 'PENDING_PAYMENT':
    case 'PLACED':
      return 0;
    case 'ACCEPTED':
      return 1;
    case 'PREPARING':
      return 2;
    case 'READY':
      return fulfillment === 'DINE_IN' ? 2 : 3;
    case 'HANDED_TO_COURIER':
    case 'OUT_FOR_DELIVERY':
    case 'ARRIVING':
      return 4;
    case 'DELIVERED':
    case 'PICKED_UP':
      return steps.length - 1;
    default:
      return -1;
  }
}

const ENDED = new Set([
  'DELIVERED',
  'PICKED_UP',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_RESTAURANT',
  'REJECTED',
  'REFUNDED',
]);

export function TrackingLive({ token, initial, locale }: { token: string; initial: OrderTrackingDTO; locale: string }) {
  const [tracking, setTracking] = useState(initial);
  const [connection, setConnection] = useState<'idle' | 'live' | 'reconnecting'>('idle');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const t = useMemo(
    () =>
      createTranslator({
        locale,
        messages: BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE],
        fallback: BUNDLED_MESSAGES[BASE_LOCALE],
      }),
    [locale],
  );
  const time = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale]);
  const km = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale]);

  useEffect(() => {
    if (ENDED.has(tracking.status) || typeof EventSource === 'undefined') return undefined;
    const source = new EventSource(`/api/bff/public/orders/${encodeURIComponent(token)}/events`);
    const onUpdate = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { type: string; tracking?: OrderTrackingDTO };
        if (payload.type === 'tracking.updated' && payload.tracking) {
          setTracking(payload.tracking);
          setUpdatedAt(new Date());
        }
        setConnection('live');
      } catch {
        // A malformed frame is ignored; the next event carries the full state again.
      }
    };
    source.addEventListener('tracking.updated', onUpdate as EventListener);
    source.onopen = () => setConnection('live');
    source.onerror = () => setConnection('reconnecting');
    return () => source.close();
    // The stream is opened once per token; status changes arrive through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const steps = STEPS[tracking.fulfillment];
  const reached = stepIndex(tracking.status, tracking.fulfillment);
  const cancelled = reached < 0;
  const statusKey =
    tracking.status === 'READY' && tracking.fulfillment === 'DELIVERY'
      ? 'tracking.status.READY.DELIVERY'
      : `tracking.status.${tracking.status}`;
  const courier = tracking.courier;
  const mapsUrl = courier?.position
    ? `https://www.google.com/maps?q=${courier.position.lat},${courier.position.lng}`
    : null;

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={t(statusKey)}
        aside={
          connection !== 'idle' && !ENDED.has(tracking.status) ? (
            <span className={cx('pui-badge', connection === 'live' ? 'pui-soft pui-success' : 'pui-soft pui-warn')}>
              {connection === 'live' ? t('tracking.live') : t('tracking.reconnecting')}
            </span>
          ) : null
        }
      >
        <ol className="flex flex-col gap-2" aria-label={t('tracking.title')}>
          {steps.map((step, index) => {
            const done = !cancelled && index <= reached;
            return (
              <li
                key={step}
                className="flex items-center gap-3"
                aria-current={!cancelled && index === reached ? 'step' : undefined}
              >
                <span
                  className={cx('pui-badge', done ? 'pui-solid pui-theme' : 'pui-soft pui-muted')}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className={done ? undefined : 'ui-text-muted'}>{t(`tracking.step.${step}`)}</span>
              </li>
            );
          })}
        </ol>
        <div className="mt-4 flex flex-col gap-1">
          {tracking.promisedReadyAt && reached >= 1 && reached <= 3 && (
            <p className="ui-text-muted">
              {t('tracking.promisedReadyAt', { time: time.format(new Date(tracking.promisedReadyAt)) })}
            </p>
          )}
          {tracking.estimatedDeliveryAt && reached === 4 && (
            <p className="ui-text-muted">
              {t('tracking.estimatedDeliveryAt', { time: time.format(new Date(tracking.estimatedDeliveryAt)) })}
            </p>
          )}
          {updatedAt && <p className="ui-caption">{t('tracking.updatedAt', { time: time.format(updatedAt) })}</p>}
        </div>
      </Card>

      {courier && (
        <Card title={t('tracking.courier', { name: courier.firstName })}>
          <div className="flex flex-col gap-2">
            {courier.stopsAhead > 0 && <p>{t('tracking.stopsAhead', { count: courier.stopsAhead })}</p>}
            {courier.distanceMeters !== null && (
              <p className="ui-heading">
                {t('tracking.courierDistance', { km: km.format(courier.distanceMeters / 1000) })}
              </p>
            )}
            {mapsUrl && (
              <LinkButton href={mapsUrl} target="_blank" rel="noreferrer" variant="outline" tone="muted">
                {t('tracking.openMap')}
              </LinkButton>
            )}
          </div>
        </Card>
      )}

      <Card title={t('tracking.items')}>
        <ul className="ui-divide">
          {tracking.items.map((item, index) => (
            <li key={`${item.name}-${index}`} className="flex items-center justify-between gap-4 py-2">
              <span>{item.name}</span>
              <span className="ui-price">{item.quantity}</span>
            </li>
          ))}
        </ul>
        {tracking.restaurant.phone && (
          <div className="mt-4">
            <LinkButton href={`tel:${tracking.restaurant.phone}`} variant="soft" tone="theme" block>
              {t('tracking.callRestaurant')}
            </LinkButton>
          </div>
        )}
      </Card>
    </div>
  );
}
