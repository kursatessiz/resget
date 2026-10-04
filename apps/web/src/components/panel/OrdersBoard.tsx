'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTerminalOrderStatus } from '@resget/shared';
import type { OrderDetailDTO, OrderStatusValue, OrderSummaryDTO, RealtimeEvent } from '@resget/shared';
import { Badge, Button } from '@/components/ui';
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
const SOUND_KEY = 'resget_orders_sound';

/** A short two-tone chime through the Web Audio API; silent when the browser has not allowed audio yet. */
function chime(): void {
  try {
    const AudioCtx = window.AudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const play = (frequency: number, at: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = frequency;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.18);
    };
    play(880, 0);
    play(1175, 0.2);
    setTimeout(() => void ctx.close(), 800);
  } catch {
    // Audio is a convenience; the card itself carries the alarm.
  }
}

/**
 * The live order screen (docs/SIPARIS_VE_SEVK.md). Loads the active orders
 * once and then follows the restaurant's order events; every action goes
 * through the API's state machine, so the screen never guesses a status.
 */
export function OrdersBoard({
  restaurantId,
  locale,
  canManage,
  canRefund = false,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
  canRefund?: boolean;
}) {
  const t = useT(locale);
  const [orders, setOrders] = useState<Map<string, OrderSummaryDTO>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [, setTick] = useState(0);
  const seen = useRef<Set<string>>(new Set());
  const alarmed = useRef<Set<string>>(new Set());
  const base = `restaurants/${restaurantId}/orders`;

  useEffect(() => {
    try {
      setSoundOn(window.localStorage.getItem(SOUND_KEY) !== 'off');
    } catch {
      // Private mode: the default stays on.
    }
    // Countdown badges re-render every half minute without a server round trip.
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const toggleSound = () => {
    setSoundOn((on) => {
      try {
        window.localStorage.setItem(SOUND_KEY, on ? 'off' : 'on');
      } catch {
        // Nothing to persist to; the toggle still works for this page.
      }
      return !on;
    });
  };

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
        for (const o of [...done, ...active]) seen.current.add(o.id);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')));
    return () => {
      cancelled = true;
    };
  }, [base, t]);

  const status = useRealtime(`${base}/events`, (event: RealtimeEvent) => {
    if (event.type !== 'order.updated') return;
    const order = event.order;
    // A new order on the screen, or an order whose acceptance alarm fired: sound once each.
    const overdue =
      order.status === 'PLACED' &&
      order.acceptDeadlineAt !== null &&
      new Date(order.acceptDeadlineAt).getTime() <= Date.now();
    const fresh = order.status === 'PLACED' && !seen.current.has(order.id);
    seen.current.add(order.id);
    if (soundOn && (fresh || (overdue && !alarmed.current.has(order.id)))) chime();
    if (overdue) alarmed.current.add(order.id);
    upsert(order);
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

  const refund = async (order: OrderSummaryDTO, reason: string) => {
    setBusyId(order.id);
    setError(null);
    try {
      const updated = await bffJson<OrderDetailDTO>(`${base}/${order.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
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
        <div className="flex items-center gap-2">
          <Button variant="outline" tone="muted" onClick={toggleSound} aria-pressed={soundOn}>
            {soundOn ? t('orders.sound.on') : t('orders.sound.off')}
          </Button>
          <Badge tone={status === 'live' ? 'success' : 'warn'}>
            {status === 'live' ? t('orders.live') : t('orders.reconnecting')}
          </Badge>
        </div>
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
                  canRefund={canRefund}
                  busy={busyId === order.id}
                  onTransition={(o, to, extra) => void transition(o, to, extra)}
                  onRefund={(o, reason) => void refund(o, reason)}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
