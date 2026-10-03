import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type { OrderSummaryDTO } from '@resget/shared';
import { Body, Caption, Card, Notice, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { deviceLocale, useT } from '@/lib/i18n';
import { useSession } from '@/state/session';

/** The restaurant's recent orders, read-only on the phone; the kitchen flow stays on the tablet and the web. */
export default function Orders() {
  const t = useT();
  const locale = deviceLocale();
  const { api, membership } = useSession();
  const [orders, setOrders] = useState<OrderSummaryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!membership) return;
    try {
      setOrders(
        await api.request<OrderSummaryDTO[]>(`restaurants/${membership.restaurantId}/orders?limit=30`, {
          restaurantId: membership.restaurantId,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('mobile.error.network'));
    }
  }, [api, membership, t]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <Screen>
      <Title>{t('mobile.tabs.orders')}</Title>
      {error && <Notice tone="error">{error}</Notice>}
      {orders && orders.length === 0 && <Body muted>{t('orders.empty')}</Body>}
      {orders?.map((order) => (
        <Card key={order.id} title={t('orders.shortCode', { code: order.shortCode })}>
          <Body>
            {t(`orders.status.${order.status}`)}, {t(`orders.fulfillment.${order.fulfillment}`)}
          </Body>
          <Caption>
            {formatMoney({ amountMinor: order.chargedToCustomerMinor, currency: order.currency }, locale)},{' '}
            {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(order.placedAt))}
          </Caption>
        </Card>
      ))}
    </Screen>
  );
}
