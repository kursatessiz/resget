'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isKitchenTicketLate } from '@resget/shared';
import type { KitchenBoardDTO, KitchenItemDTO, KitchenTicketDTO, RealtimeEvent } from '@resget/shared';
import { Badge, Button, Card, SelectField } from '@/components/ui';
import { ApiError, bffJson, useRealtime } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * The kitchen display (docs/MUTFAK_EKRANI.md): accepted orders as tickets,
 * the earliest promise first. A cook marks lines done; the first done line
 * starts the order, Ready finishes it. Order events from any screen reload
 * the board, so several kitchen tablets stay in step.
 */
export function KitchenDisplay({
  restaurantId,
  locale,
  canManage,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
}) {
  const t = useT(locale);
  const [board, setBoard] = useState<KitchenBoardDTO | null>(null);
  const [station, setStation] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const slot = new Intl.DateTimeFormat(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const load = useCallback(
    () =>
      bffJson<KitchenBoardDTO>(
        `restaurants/${restaurantId}/kitchen${station ? `?station=${encodeURIComponent(station)}` : ''}`,
      )
        .then((next) => {
          setBoard(next);
          setError(null);
        })
        .catch(fail),
    [restaurantId, station, fail],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    // Late badges move with the clock, not only with events.
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const status = useRealtime(`restaurants/${restaurantId}/orders/events`, (event: RealtimeEvent) => {
    if (event.type !== 'order.updated') return;
    // A burst of events (one per marked line) reloads the board once.
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void load(), 300);
  });

  const mark = async (item: KitchenItemDTO) => {
    setBusy(item.id);
    try {
      await bffJson(`restaurants/${restaurantId}/kitchen/items/${item.id}/prepared`, {
        method: 'POST',
        body: JSON.stringify({ prepared: item.preparedAt === null }),
      });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const ready = async (ticket: KitchenTicketDTO) => {
    setBusy(ticket.orderId);
    try {
      await bffJson(`restaurants/${restaurantId}/orders/${ticket.orderId}/transition`, {
        method: 'POST',
        body: JSON.stringify({ to: 'READY' }),
      });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="ui-title">{t('kitchen.title')}</h1>
          <p className="ui-text-muted">{t('kitchen.intro')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {board && board.stations.length > 0 && (
            <SelectField
              label={t('kitchen.station.label')}
              value={station}
              onChange={(event) => setStation(event.target.value)}
            >
              <option value="">{t('kitchen.station.all')}</option>
              {board.stations.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </SelectField>
          )}
          <Badge tone={status === 'live' ? 'success' : 'warn'}>
            {status === 'live' ? t('kitchen.live') : t('kitchen.reconnecting')}
          </Badge>
        </div>
      </header>
      {error && (
        <p role="alert" className="pui-badge pui-soft pui-error">
          {error}
        </p>
      )}
      {board && board.tickets.length === 0 && <p className="ui-text-muted">{t('kitchen.empty')}</p>}
      {board && board.tickets.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {board.tickets.map((ticket) => {
            const late = isKitchenTicketLate(ticket, now);
            const done = ticket.items.filter((item) => item.preparedAt !== null).length;
            return (
              <Card
                key={ticket.orderId}
                data-ticket={ticket.orderId}
                title={t('kitchen.ticket.title', { code: ticket.shortCode })}
                aside={
                  <span className="flex flex-wrap gap-1">
                    <Badge tone="muted">{t(`orders.fulfillment.${ticket.fulfillment}`)}</Badge>
                    {late && <Badge tone="error">{t('kitchen.ticket.late')}</Badge>}
                  </span>
                }
              >
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {ticket.tableLabel && (
                      <span className="ui-heading">{t('kitchen.ticket.table', { table: ticket.tableLabel })}</span>
                    )}
                    {ticket.promisedReadyAt && (
                      <span className="ui-caption">
                        {t('kitchen.ticket.due', { time: time.format(new Date(ticket.promisedReadyAt)) })}
                      </span>
                    )}
                    {ticket.scheduledFor && (
                      <span className="ui-caption">
                        {t('kitchen.ticket.scheduled', { time: slot.format(new Date(ticket.scheduledFor)) })}
                      </span>
                    )}
                  </div>
                  <ul className="ui-divide">
                    {ticket.items.map((item) => (
                      <li key={item.id} className="flex items-start justify-between gap-3 py-2">
                        <div className="flex flex-col">
                          <span className={item.preparedAt ? 'ui-text-muted' : 'ui-heading'}>
                            {t('kitchen.item.quantity', { quantity: item.quantity, name: item.name })}
                          </span>
                          {item.modifiers.length > 0 && <span className="ui-caption">{item.modifiers.join(', ')}</span>}
                        </div>
                        {canManage && (
                          <Button
                            variant={item.preparedAt ? 'outline' : 'soft'}
                            tone={item.preparedAt ? 'muted' : 'success'}
                            disabled={busy !== null}
                            aria-label={`${item.preparedAt ? t('kitchen.item.unmark') : t('kitchen.item.mark')}: ${item.name}`}
                            onClick={() => void mark(item)}
                          >
                            {item.preparedAt ? t('kitchen.item.unmark') : t('kitchen.item.mark')}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {ticket.note && <p className="ui-caption">{t('kitchen.ticket.note', { note: ticket.note })}</p>}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="ui-caption" data-progress={`${done}/${ticket.items.length}`}>
                      {t('kitchen.ticket.progress', { done, total: ticket.items.length })}
                    </span>
                    {canManage && ticket.status === 'PREPARING' && (
                      <Button disabled={busy !== null} onClick={() => void ready(ticket)}>
                        {t('kitchen.action.ready')}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
