'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BASE_LOCALE,
  BUNDLED_MESSAGES,
  RATING_COMMENT_MAX,
  RATING_MAX,
  RATING_MIN,
  TRACKING_STEPS,
  createTranslator,
  isTrackingEnded,
  trackingStatusMessageKey,
  trackingStepIndex,
} from '@resget/shared';
import type { OrderTrackingDTO } from '@resget/shared';
import { ClaimCard } from '@/components/ClaimCard';
import { FeedbackCard } from '@/components/FeedbackCard';
import { TipCard } from '@/components/TipCard';
import { TrackingReview } from '@/components/TrackingReview';
import { LiveMap } from '@/components/LiveMap';
import { Button, Card, LinkButton, TextAreaField } from '@/components/ui';
import type { MapMarker, MapTilesConfig } from '@/lib/map';
import { ApiError, bffJson } from '@/lib/client-api';
import { cx } from '@/components/ui/types';

export function TrackingLive({
  token,
  initial,
  locale,
  tiles,
}: {
  token: string;
  initial: OrderTrackingDTO;
  locale: string;
  tiles: MapTilesConfig;
}) {
  const [tracking, setTracking] = useState(initial);
  const [connection, setConnection] = useState<'idle' | 'live' | 'reconnecting'>('idle');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [thanked, setThanked] = useState(false);
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
    if (isTrackingEnded(tracking.status) || typeof EventSource === 'undefined') return undefined;
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

  const submitRating = async () => {
    if (score === null) return;
    setRatingBusy(true);
    setRatingError(null);
    try {
      const next = await bffJson<OrderTrackingDTO>(`public/orders/${encodeURIComponent(token)}/rating`, {
        method: 'POST',
        body: JSON.stringify({ score, ...(comment.trim() ? { comment: comment.trim() } : {}) }),
      });
      setTracking(next);
      setThanked(true);
    } catch (err) {
      setRatingError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setRatingBusy(false);
    }
  };
  const scores = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);

  const steps = TRACKING_STEPS[tracking.fulfillment];
  const reached = trackingStepIndex(tracking.status, tracking.fulfillment);
  const cancelled = reached < 0;
  const statusKey = trackingStatusMessageKey(tracking.status, tracking.fulfillment);
  const courier = tracking.courier;
  const mapsUrl = courier?.position
    ? `https://www.google.com/maps?q=${courier.position.lat},${courier.position.lng}`
    : null;
  // The map shows the courier and the door while the order is on the road; nothing else of anyone else.
  const markers: MapMarker[] = [];
  if (courier?.position) {
    markers.push({
      id: 'courier',
      lat: courier.position.lat,
      lng: courier.position.lng,
      label: t('tracking.map.courier', { name: courier.firstName }),
      kind: 'courier',
    });
  }
  if (tracking.destination && courier && !isTrackingEnded(tracking.status)) {
    markers.push({
      id: 'destination',
      lat: tracking.destination.lat,
      lng: tracking.destination.lng,
      label: t('tracking.map.destination'),
      kind: 'destination',
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={t(statusKey)}
        aside={
          connection !== 'idle' && !isTrackingEnded(tracking.status) ? (
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
          {tracking.scheduledFor && reached <= 3 && (
            <p className="ui-text-muted" data-scheduled-for>
              {t('tracking.scheduledFor', {
                time: new Intl.DateTimeFormat(locale, {
                  weekday: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(tracking.scheduledFor)),
              })}
            </p>
          )}
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

      {tracking.deliveryCode && (
        <Card title={t('tracking.deliveryCode.title')}>
          <div className="flex flex-col gap-2">
            <p className="ui-title" data-delivery-code>
              {tracking.deliveryCode}
            </p>
            <p className="ui-caption">{t('tracking.deliveryCode.hint')}</p>
          </div>
        </Card>
      )}

      {courier && (
        <Card title={t('tracking.courier', { name: courier.firstName })}>
          <div className="flex flex-col gap-2">
            {markers.length > 0 && <LiveMap tiles={tiles} markers={markers} label={t('tracking.map')} />}
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

      <ClaimCard token={token} tracking={tracking} locale={locale} t={t} onUpdated={setTracking} />

      {(tracking.canRate || tracking.rating) && (
        <Card title={t('tracking.rating.title')} aria-label={t('tracking.rating.title')}>
          {tracking.rating ? (
            <TrackingReview
              token={token}
              rating={tracking.rating}
              locale={locale}
              thanked={thanked}
              t={t}
              onUpdated={setTracking}
            />
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitRating();
              }}
            >
              <p className="ui-caption">{t('tracking.rating.intro')}</p>
              <fieldset className="flex flex-wrap gap-3">
                <legend className="ui-heading">{t('tracking.rating.score')}</legend>
                {scores.map((value) => (
                  <label key={value} className="flex items-center gap-1">
                    <input
                      type="radio"
                      className="pui-radio"
                      name="rating"
                      value={value}
                      checked={score === value}
                      onChange={() => setScore(value)}
                      aria-label={t('tracking.rating.star', { count: value })}
                    />
                    <span>{value}</span>
                  </label>
                ))}
              </fieldset>
              <TextAreaField
                label={t('tracking.rating.comment')}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={RATING_COMMENT_MAX}
                rows={3}
              />
              {ratingError && (
                <p role="alert" className="pui-alert pui-error">
                  {ratingError}
                </p>
              )}
              <div>
                <Button type="submit" disabled={ratingBusy || score === null}>
                  {t('tracking.rating.submit')}
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}

      <TipCard token={token} tracking={tracking} t={t} locale={locale} />

      <FeedbackCard token={token} tracking={tracking} t={t} onUpdated={setTracking} />

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
