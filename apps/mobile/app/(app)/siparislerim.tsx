import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatMoney, trackingTokenFromLink } from '@resget/shared';
import type { CustomerAccountDTO, CustomerOrderDTO, LoyaltyBalanceDTO } from '@resget/shared';
import { Body, Button, Caption, Card, Notice, Screen, Title } from '@/components/ui';
import { WalletsCard } from '@/components/wallets-card';
import { ApiError } from '@/lib/api';
import { deviceLocale, useT } from '@/lib/i18n';
import { openWebPage } from '@/lib/web-handoff';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme';

/**
 * The person's own orders as a customer, with live tracking in the app and
 * reordering on the restaurant's page, and the points they hold at each
 * restaurant (docs/SADAKAT.md, same balances as the web account page).
 * Restaurant pages open signed in, so linked wallet cards are offered at
 * payment (docs/CUZDAN.md, "Mobil uygulama").
 */
export default function MyOrders() {
  const t = useT();
  const theme = useTheme();
  const locale = deviceLocale();
  const router = useRouter();
  const { api } = useSession();
  const [orders, setOrders] = useState<CustomerOrderDTO[] | null>(null);
  const [points, setPoints] = useState<LoyaltyBalanceDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const load = useCallback(async () => {
    setReloads((n) => n + 1);
    try {
      const [list, account] = await Promise.all([
        api.request<CustomerOrderDTO[]>('me/orders'),
        api.request<CustomerAccountDTO>('me/account'),
      ]);
      setOrders(list);
      setPoints(account.loyalty);
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
  const openRestaurant = (slug: string) => void openWebPage(api, `/${encodeURIComponent(slug)}`);
  return (
    <Screen>
      <Title>{t('mobile.tabs.myOrders')}</Title>
      <Body muted>{t('mobile.customer.intro')}</Body>
      {error && <Notice tone="error">{error}</Notice>}
      <WalletsCard api={api} reloadKey={reloads} />
      {points.length > 0 && (
        <Card title={t('loyalty.account.title')}>
          {points.map((balance) => (
            <View key={balance.restaurant.slug} style={{ gap: theme.spacing[1] }}>
              <Body>{t('loyalty.account.line', { restaurant: balance.restaurant.name, points: balance.points })}</Body>
              {balance.valueMinor > 0 && (
                <Caption>
                  {t('loyalty.account.value', {
                    amount: formatMoney({ amountMinor: balance.valueMinor, currency: balance.currency }, locale),
                  })}
                </Caption>
              )}
              {balance.tier && <Caption>{t('loyalty.tiers.label', { tier: balance.tier })}</Caption>}
              {balance.nextTier && (
                <Caption>
                  {t('loyalty.tiers.next', {
                    tier: balance.nextTier.name,
                    amount: formatMoney(
                      { amountMinor: balance.nextTier.remainingMinor, currency: balance.currency },
                      locale,
                    ),
                  })}
                </Caption>
              )}
              <Button
                label={t('loyalty.account.order')}
                variant="outline"
                tone="muted"
                onPress={() => openRestaurant(balance.restaurant.slug)}
              />
            </View>
          ))}
        </Card>
      )}
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
              onPress={() => openRestaurant(order.restaurant.slug)}
            />
          </Card>
        );
      })}
      {orders && orders.length > 0 && <Caption>{t('mobile.customer.reorderHint')}</Caption>}
    </Screen>
  );
}
