import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, useWindowDimensions, Vibration, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Notifications from 'expo-notifications';
import {
  ORDER_PREP_OPTIONS,
  courierCallActions,
  formatMoney,
  freshPlacedOrderIds,
  isTerminalOrderStatus,
  orderActionsFor,
} from '@resget/shared';
import type { CourierNetworkStatusDTO, OrderActionSpec, OrderSummaryDTO } from '@resget/shared';
import { Body, Button, Caption, Card, Field, Notice, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { isTabletWidth } from '@/lib/dispatch';
import { deviceLocale, useT } from '@/lib/i18n';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme';

/** The kitchen follows new orders closely while handling is on; read-only lists refresh slowly. */
const HANDLING_REFRESH_MS = 8000;
const READ_ONLY_REFRESH_MS = 15_000;
const ALERT_PATTERN = [0, 400, 200, 400];

/**
 * The restaurant's orders on a tablet or a phone (docs/MOBIL.md,
 * docs/SIPARIS_VE_SEVK.md). With the app_order_handling module on and
 * orders.manage, staff accept with a preparation time, reject or cancel
 * with a reason and move the order on, using the same action table as the
 * web screen; a new order vibrates and raises a notification. Otherwise the
 * list is read-only. Two columns from tablet width.
 */
export default function Orders() {
  const t = useT();
  const theme = useTheme();
  const locale = deviceLocale();
  const { width } = useWindowDimensions();
  const { api, membership } = useSession();
  const [orders, setOrders] = useState<OrderSummaryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ orderId: string; action: OrderActionSpec } | null>(null);
  const [prepMinutes, setPrepMinutes] = useState<number>(20);
  const [reason, setReason] = useState('');
  const seen = useRef<Set<string> | null>(null);
  const handling =
    !!membership &&
    membership.features.includes('app_order_handling') &&
    membership.permissions.includes('orders.manage');
  const base = membership ? `restaurants/${membership.restaurantId}/orders` : null;
  // A courier network call from the order (docs/KURYE.md), for members who dispatch.
  const canDispatch = handling && !!membership && membership.permissions.includes('dispatch.manage');
  const [network, setNetwork] = useState<CourierNetworkStatusDTO | null>(null);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('mobile.error.network')),
    [t],
  );

  const alert = useCallback(
    async (fresh: OrderSummaryDTO[]) => {
      Vibration.vibrate(ALERT_PATTERN);
      for (const order of fresh) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: t('mobile.orders.newTitle'),
            body: t('mobile.orders.newBody', { code: order.shortCode }),
            sound: true,
          },
          trigger: null,
        }).catch(() => undefined);
      }
    },
    [t],
  );

  const load = useCallback(async () => {
    if (!base || !membership) return;
    try {
      const path = handling ? `${base}?active=true&limit=100` : `${base}?limit=30`;
      const next = await api.request<OrderSummaryDTO[]>(path, { restaurantId: membership.restaurantId });
      setOrders(next);
      setError(null);
      // The first load only learns what is already there; later loads sound for what is new.
      if (seen.current === null) {
        seen.current = new Set(next.map((o) => o.id));
      } else if (handling) {
        const freshIds = new Set(freshPlacedOrderIds(next, seen.current));
        next.forEach((o) => seen.current?.add(o.id));
        if (freshIds.size > 0) void alert(next.filter((o) => freshIds.has(o.id)));
      }
    } catch (err) {
      fail(err);
    }
  }, [alert, api, base, fail, handling, membership]);

  useFocusEffect(
    useCallback(() => {
      if (canDispatch && membership) {
        api
          .request<CourierNetworkStatusDTO>(`restaurants/${membership.restaurantId}/courier/network`, {
            restaurantId: membership.restaurantId,
          })
          .then(setNetwork)
          .catch(() => setNetwork(null));
      }
    }, [api, canDispatch, membership]),
  );

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), handling ? HANDLING_REFRESH_MS : READ_ONLY_REFRESH_MS);
      return () => clearInterval(timer);
    }, [handling, load]),
  );

  const run = async (order: OrderSummaryDTO, action: OrderActionSpec) => {
    if (!base || !membership) return;
    setBusyId(order.id);
    setError(null);
    try {
      await api.request(`${base}/${order.id}/transition`, {
        method: 'POST',
        body: {
          to: action.to,
          ...(action.needsPrep ? { prepMinutes } : {}),
          ...(action.needsReason ? { reason: reason.trim() } : {}),
        },
        restaurantId: membership.restaurantId,
      });
      setPending(null);
      setReason('');
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusyId(null);
    }
  };

  const courier = async (order: OrderSummaryDTO, action: 'call' | 'cancel') => {
    if (!base || !membership) return;
    setBusyId(order.id);
    setError(null);
    try {
      await api.request(`${base}/${order.id}/courier-request${action === 'cancel' ? '/cancel' : ''}`, {
        method: 'POST',
        body: {},
        restaurantId: membership.restaurantId,
      });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusyId(null);
    }
  };

  const press = (order: OrderSummaryDTO, action: OrderActionSpec) => {
    if (action.needsPrep || action.needsReason) {
      setPending({ orderId: order.id, action });
      setReason('');
    } else {
      void run(order, action);
    }
  };

  const card = (order: OrderSummaryDTO) => {
    const overdue =
      order.status === 'PLACED' &&
      order.acceptDeadlineAt !== null &&
      new Date(order.acceptDeadlineAt).getTime() <= Date.now();
    const actions = handling ? orderActionsFor(order) : [];
    const open = pending?.orderId === order.id ? pending.action : null;
    const courierActions = canDispatch
      ? courierCallActions(order, network?.available === true)
      : { call: false, cancel: false };
    return (
      <Card key={order.id} title={t('orders.shortCode', { code: order.shortCode })}>
        <Body>
          {t(`orders.status.${order.status}`)}, {t(`orders.fulfillment.${order.fulfillment}`)}
        </Body>
        <Caption>
          {formatMoney({ amountMinor: order.chargedToCustomerMinor, currency: order.currency }, locale)},{' '}
          {time.format(new Date(order.placedAt))}
          {order.promisedReadyAt
            ? ` / ${t('orders.promisedReadyAt')} ${time.format(new Date(order.promisedReadyAt))}`
            : ''}
        </Caption>
        {overdue && <Notice tone="error">{t('mobile.orders.overdue')}</Notice>}
        {order.courierRequest && (
          <Caption>
            {t('courier.call.label', {
              provider: order.courierRequest.providerName,
              status: t(`courier.requests.status.${order.courierRequest.status}`),
            })}
          </Caption>
        )}
        {!open && (courierActions.call || courierActions.cancel) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2] }}>
            {courierActions.call && (
              <Button
                label={t('courier.call.button')}
                variant="outline"
                busy={busyId === order.id}
                onPress={() => void courier(order, 'call')}
              />
            )}
            {courierActions.cancel && (
              <Button
                label={t('courier.call.cancel')}
                variant="outline"
                tone="error"
                busy={busyId === order.id}
                onPress={() => void courier(order, 'cancel')}
              />
            )}
          </View>
        )}
        {open ? (
          <View style={{ gap: theme.spacing[2] }}>
            {open.needsPrep && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2] }}>
                {ORDER_PREP_OPTIONS.map((minutes) => (
                  <Pressable
                    key={minutes}
                    accessibilityRole="button"
                    accessibilityState={{ selected: prepMinutes === minutes }}
                    onPress={() => setPrepMinutes(minutes)}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.colors.theme,
                      backgroundColor: prepMinutes === minutes ? theme.colors.theme : 'transparent',
                      borderRadius: theme.radii.sm,
                      paddingVertical: theme.spacing[2],
                      paddingHorizontal: theme.spacing[3],
                    }}
                  >
                    <Text style={{ color: prepMinutes === minutes ? theme.colors.onTheme : theme.colors.theme }}>
                      {t('orders.prepMinutesOption', { minutes })}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {open.needsReason && (
              <Field
                label={open.to === 'REJECTED' ? t('orders.rejectReason') : t('orders.cancelReason')}
                value={reason}
                onChangeText={setReason}
                maxLength={300}
              />
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2] }}>
              <Button
                label={t('mobile.orders.confirm')}
                tone={open.tone ?? 'theme'}
                busy={busyId === order.id}
                disabled={open.needsReason === true && reason.trim() === ''}
                onPress={() => void run(order, open)}
              />
              <Button label={t('common.cancel')} variant="outline" tone="muted" onPress={() => setPending(null)} />
            </View>
          </View>
        ) : (
          actions.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2] }}>
              {actions.map((action) => (
                <Button
                  key={action.to}
                  label={t(action.labelKey)}
                  tone={action.tone ?? 'theme'}
                  variant={action.tone ? 'outline' : 'solid'}
                  busy={busyId === order.id}
                  onPress={() => press(order, action)}
                />
              ))}
            </View>
          )
        )}
      </Card>
    );
  };

  const fresh = (orders ?? []).filter((o) => o.status === 'PLACED');
  const others = (orders ?? []).filter((o) => o.status !== 'PLACED' && (!handling || !isTerminalOrderStatus(o.status)));
  const tablet = isTabletWidth(width) && handling;

  return (
    <Screen>
      <Title>{t('mobile.tabs.orders')}</Title>
      {error && <Notice tone="error">{error}</Notice>}
      {!handling && <Caption>{t('mobile.orders.readOnly')}</Caption>}
      {handling && fresh.length > 0 && (
        <Notice tone="success">{t('mobile.orders.newBanner', { count: fresh.length })}</Notice>
      )}
      {orders && orders.length === 0 && <Body muted>{t('orders.empty.new')}</Body>}
      {tablet ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing[4] }}>
          <View style={{ flex: 1, gap: theme.spacing[3] }}>
            <Caption>{t('orders.section.new')}</Caption>
            {fresh.length === 0 ? <Body muted>{t('orders.empty.new')}</Body> : fresh.map(card)}
          </View>
          <View style={{ flex: 1, gap: theme.spacing[3] }}>
            <Caption>{t('orders.section.kitchen')}</Caption>
            {others.length === 0 ? <Body muted>{t('orders.empty.kitchen')}</Body> : others.map(card)}
          </View>
        </View>
      ) : (
        [...fresh, ...others].map(card)
      )}
    </Screen>
  );
}
