import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  RATING_COMMENT_MAX,
  RATING_MAX,
  RATING_MIN,
  TRACKING_STEPS,
  isTrackingEnded,
  trackingStatusMessageKey,
  trackingStepIndex,
  trackingTokenFromLink,
} from '@resget/shared';
import type { OrderTrackingDTO } from '@resget/shared';
import { MapPanel, useInAppMap } from '@/components/map-panel';
import type { MapPin } from '@/components/map-panel';
import { Body, Button, Caption, Card, Field, Notice, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { deviceLocale, useT } from '@/lib/i18n';
import { trackingMapModel } from '@/lib/maps';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme';

/** How often the public tracking snapshot is re-read while the order is still moving. */
const REFRESH_MS = 10_000;

/**
 * The customer's live order (docs/SIPARIS_VE_SEVK.md): the same snapshot the
 * web page shows, re-read every few seconds until the order ends. Opened from
 * the orders tab or from a tracking link (`/t/<token>`, `resget://t/<token>`);
 * no sign-in is needed, the token is the credential.
 */
export default function TrackingScreen() {
  const t = useT();
  const locale = deviceLocale();
  const theme = useTheme();
  const router = useRouter();
  const { api } = useSession();
  const params = useLocalSearchParams<{ token: string }>();
  const token = trackingTokenFromLink(`/t/${String(params.token ?? '')}`);
  const [tracking, setTracking] = useState<OrderTrackingDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const showMap = useInAppMap();

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setTracking(await api.request<OrderTrackingDTO>(`public/orders/${encodeURIComponent(token)}`, { auth: false }));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 404
            ? t('mobile.tracking.notFound')
            : t(`errors.${err.code}`)
          : t('mobile.error.network'),
      );
    }
  }, [api, t, token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!tracking || isTrackingEnded(tracking.status)) return undefined;
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, tracking]);

  const submitRating = async () => {
    if (!token || score === null) return;
    setBusy(true);
    try {
      setTracking(
        await api.request<OrderTrackingDTO>(`public/orders/${encodeURIComponent(token)}/rating`, {
          method: 'POST',
          auth: false,
          body: { score, ...(comment.trim() ? { comment: comment.trim() } : {}) },
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('mobile.error.network'));
    } finally {
      setBusy(false);
    }
  };

  // The courier and the door while the order is on the road, the same rule as the web page.
  const map = useMemo(() => {
    if (!tracking) return null;
    const model = trackingMapModel(tracking);
    const pins: MapPin[] = [];
    if (model.destination) {
      pins.push({
        id: 'destination',
        point: model.destination,
        title: t('tracking.map.destination'),
        tone: 'success',
        shape: 'square',
      });
    }
    if (model.courier && tracking.courier) {
      pins.push({
        id: 'courier',
        point: model.courier,
        title: t('tracking.map.courier', { name: tracking.courier.firstName }),
        tone: 'theme',
      });
    }
    return pins.length > 0 ? { pins, region: model.region } : null;
  }, [t, tracking]);

  if (!token) {
    return (
      <Screen>
        <Title>{t('mobile.tracking.title')}</Title>
        <Notice tone="error">{t('mobile.tracking.notFound')}</Notice>
        <Button label={t('mobile.tracking.back')} variant="outline" tone="muted" onPress={() => router.back()} />
      </Screen>
    );
  }

  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const km = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const steps = tracking ? TRACKING_STEPS[tracking.fulfillment] : [];
  const reached = tracking ? trackingStepIndex(tracking.status, tracking.fulfillment) : -1;
  const cancelled = reached < 0;
  const courier = tracking?.courier ?? null;
  const scores = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);

  return (
    <Screen>
      <Title>
        {tracking ? t('tracking.orderFrom', { restaurant: tracking.restaurant.name }) : t('mobile.tracking.title')}
      </Title>
      {error && <Notice tone="error">{error}</Notice>}
      {tracking && (
        <Card title={t(trackingStatusMessageKey(tracking.status, tracking.fulfillment))}>
          {steps.map((step, index) => {
            const done = !cancelled && index <= reached;
            return (
              <View key={step} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] }}>
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: theme.radii.full,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: done ? theme.colors.theme : theme.colors.border,
                  }}
                >
                  <Caption>{String(index + 1)}</Caption>
                </View>
                <Body muted={!done}>{t(`tracking.step.${step}`)}</Body>
              </View>
            );
          })}
          {tracking.promisedReadyAt && reached >= 1 && reached <= 3 && (
            <Caption>
              {t('tracking.promisedReadyAt', { time: time.format(new Date(tracking.promisedReadyAt)) })}
            </Caption>
          )}
          {tracking.estimatedDeliveryAt && reached === 4 && (
            <Caption>
              {t('tracking.estimatedDeliveryAt', { time: time.format(new Date(tracking.estimatedDeliveryAt)) })}
            </Caption>
          )}
          {!isTrackingEnded(tracking.status) && <Caption>{t('mobile.tracking.refresh')}</Caption>}
        </Card>
      )}
      {courier && (
        <Card title={t('tracking.courier', { name: courier.firstName })}>
          {courier.stopsAhead > 0 && <Body>{t('tracking.stopsAhead', { count: courier.stopsAhead })}</Body>}
          {courier.distanceMeters !== null && (
            <Body>{t('tracking.courierDistance', { km: km.format(courier.distanceMeters / 1000) })}</Body>
          )}
          {courier.position && (
            <Button
              label={t('tracking.openMap')}
              variant="outline"
              tone="muted"
              onPress={() =>
                void Linking.openURL(`https://www.google.com/maps?q=${courier.position!.lat},${courier.position!.lng}`)
              }
            />
          )}
        </Card>
      )}
      {showMap && map && (
        <MapPanel
          pins={map.pins}
          region={map.region}
          label={t('tracking.map')}
          fitLabel={t('mobile.map.fit')}
          height={240}
        />
      )}
      {tracking && (tracking.canRate || tracking.rating) && (
        <Card title={t('tracking.rating.title')}>
          {tracking.rating ? (
            <Body>{t('tracking.rating.given', { score: tracking.rating.score })}</Body>
          ) : (
            <>
              <Caption>{t('tracking.rating.intro')}</Caption>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2] }}>
                {scores.map((value) => (
                  <Button
                    key={value}
                    label={String(value)}
                    variant={score === value ? 'solid' : 'outline'}
                    tone={score === value ? 'theme' : 'muted'}
                    onPress={() => setScore(value)}
                  />
                ))}
              </View>
              <Field
                label={t('tracking.rating.comment')}
                value={comment}
                onChangeText={setComment}
                maxLength={RATING_COMMENT_MAX}
                multiline
              />
              <Button
                label={t('tracking.rating.submit')}
                onPress={() => void submitRating()}
                busy={busy}
                disabled={score === null}
              />
            </>
          )}
        </Card>
      )}
      {tracking && (
        <Card title={t('tracking.items')}>
          {tracking.items.map((item, index) => (
            <Body key={`${item.name}-${index}`}>
              {item.quantity} x {item.name}
            </Body>
          ))}
          {tracking.restaurant.phone && (
            <Button
              label={t('tracking.callRestaurant')}
              variant="outline"
              tone="muted"
              onPress={() => void Linking.openURL(`tel:${tracking.restaurant.phone}`)}
            />
          )}
        </Card>
      )}
    </Screen>
  );
}
