'use client';

import { useCallback, useEffect, useState } from 'react';
import { isTerminalOrderStatus } from '@resget/shared';
import type { OrderDetailDTO, OrderStatusValue, OrderSummaryDTO, RealtimeEvent } from '@resget/shared';
import { Badge } from '@/components/ui';
import { ApiError, bffJson, useRealtime } from '@/lib/client-api';
import { useT } from '@/lib/use-t';
import { OrderCard } from './OrderCard';

type SectionKey = 'new' | 'kitchen' | 'ready' | 'done';

const SECTION_OF: Record<OrderStatusValue, SectionKey> = {
  PENDING_PAYMENT: 'new',
  PLACED: 'new',
  ACCEPTED: 'kitchen',
  PREPARING: 'kitchen',
  READY: 'ready',
  HANDED_TO_COURIER: 'ready',
  OUT_FOR_DELIVERY: 'ready',
  ARRIVING: 'ready',
  DELIVERED: 'done',
  PICKED_UP: 'done',
  CANCELLED_BY_CUSTOMER: 'done',
  CANCELLED_BY_RESTAURANT: 'done',
  REJECTED: 'done',
  REFUNDED: 'done',
};
const SECTIONS: SectionKey[] = ['new', 'kitchen', 'ready', 'done'];
const DONE_STATUSES = 'DELIVERED,PICKED_UP,CANCELLED_BY_CUSTOMER,CANCELLED_BY_RESTAURANT,REJECTED,REFUNDED';

/**
 * The live order screen (docs/SIPARIS_VE_SEVK.md). Loads the active orders
 * once and then follows the restaurant's order events; every action goes
 * through the API's state machine, so the screen never guesses a status.
 */
export function OrdersBoard({
  restaurantId,
  locale,
  canManage,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
}) {
  const t = useT(locale);
  const [orders, setOrders] = useState<Map<string, OrderSummaryDTO>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `restaurants/${restaurantId}/orders`;

  const upsert = useCallback((order: OrderSummaryDTO) => {
    setOrders((current) => new Map(current).set(order.id, order));
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      bffJson<OrderSummaryDTO[]>(`${base}?active=true&limit=200`),
      bffJson<OrderSummaryDTO[]>(`${base}?status=${DONE_STATUSES}&limit=30`),
    ])
      .then(([active, done]) => {
        if (cancelled) return;
        setOrders(new Map([...done, ...active].map((o) => [o.id, o])));
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')));
    return () => {
      cancelled = true;
    };
  }, [base, t]);

  const status = useRealtime(`${base}/events`, (event: RealtimeEvent) => {
    if (event.type === 'order.updated') upsert(event.order);
  });

  const transition = async (
    order: OrderSummaryDTO,
    to: OrderStatusValue,
    extra: { prepMinutes?: number; reason?: string },
  ) => {
    setBusyId(order.id);
    setError(null);
    try {
      const updated = await bffJson<OrderDetailDTO>(`${base}/${order.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ to, ...extra }),
      });
      upsert(updated);
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusyId(null);
    }
  };

  const list = [...orders.values()].sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  const bySection = new Map<SectionKey, OrderSummaryDTO[]>(SECTIONS.map((key) => [key, []]));
  for (const order of list) bySection.get(SECTION_OF[order.status])!.push(order);
  // Oldest new order first: it has waited the longest.
  bySection.get('new')!.reverse();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="ui-title">{t('orders.title')}</h1>
        <Badge tone={status === 'live' ? 'success' : 'warn'}>
          {status === 'live' ? t('orders.live') : t('orders.reconnecting')}
        </Badge>
      </header>
      {error && (
        <p role="alert" className="pui-badge pui-soft pui-error">
          {error}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
        {SECTIONS.map((key) => {
          const items = bySection.get(key)!;
          return (
            <section key={key} className="flex flex-col gap-3" aria-label={t(`orders.section.${key}`)}>
              <h2 className="ui-heading flex items-center gap-2">
                {t(`orders.section.${key}`)}
                <Badge>{items.length}</Badge>
              </h2>
              {items.length === 0 && <p className="ui-caption">{t(`orders.empty.${key}`)}</p>}
              {items.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  locale={locale}
                  t={t}
                  canManage={canManage && !isTerminalOrderStatus(order.status)}
                  busy={busyId === order.id}
                  onTransition={(o, to, extra) => void transition(o, to, extra)}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
