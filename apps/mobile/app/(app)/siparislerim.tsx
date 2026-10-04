import { useCallback, useState } from 'react';
import { Linking } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatMoney, trackingTokenFromLink } from '@resget/shared';
import type { CustomerOrderDTO } from '@resget/shared';
import { Body, Button, Caption, Card, Notice, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { WEB_BASE_URL } from '@/lib/config';
import { deviceLocale, useT } from '@/lib/i18n';
import { useSession } from '@/state/session';

/** The person's own orders as a customer, with live tracking in the app and reordering on the restaurant's page. */
export default function MyOrders() {
  const t = useT();
  const locale = deviceLocale();
  const router = useRouter();
  const { api } = useSession();
  const [orders, setOrders] = useState<CustomerOrderDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrders(await api.request<CustomerOrderDTO[]>('me/orders'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('mobile.error.network'));
    }
  }, [api, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Screen>
      <Title>{t('mobile.tabs.myOrders')}</Title>
      <Body muted>{t('mobile.customer.intro')}</Body>
      {error && <Notice tone="error">{error}</Notice>}
      {orders && orders.length === 0 && <Body muted>{t('mobile.customer.empty')}</Body>}
      {orders?.map((order) => {
        const token = order.trackingUrl ? trackingTokenFromLink(order.trackingUrl) : null;
        return (
          <Card
            key={order.id}
            title={t('mobile.customer.order', { restaurant: order.restaurant.name, code: order.shortCode })}
          >
            <Body>
              {t(`orders.status.${order.status}`)}, {t(`orders.fulfillment.${order.fulfillment}`)}
            </Body>
            <Caption>
              {t('mobile.customer.items', { count: order.itemCount })},{' '}
              {formatMoney({ amountMinor: order.chargedToCustomerMinor, currency: order.currency }, locale)},{' '}
              {when.format(new Date(order.placedAt))}
            </Caption>
            {token && <Button label={t('mobile.customer.track')} onPress={() => router.push(`/t/${token}`)} />}
            <Button
              label={t('mobile.customer.reorder')}
              variant="outline"
              tone="muted"
              onPress={() => void Linking.openURL(`${WEB_BASE_URL}/${encodeURIComponent(order.restaurant.slug)}`)}
            />
          </Card>
        );
      })}
      {orders && orders.length > 0 && <Caption>{t('mobile.customer.reorderHint')}</Caption>}
    </Screen>
  );
}
