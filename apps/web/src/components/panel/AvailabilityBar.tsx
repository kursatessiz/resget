'use client';

import { useCallback, useEffect, useState } from 'react';
import { BUSY_EXTRA_MINUTE_CHOICES, PAUSE_MINUTE_CHOICES } from '@resget/shared';
import type { OrderAvailabilityDTO, UpdateAvailabilityInput } from '@resget/shared';
import { Badge, Button, Card } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const BUSY_SPELL_MINUTES = 60;
const REFRESH_MS = 60_000;

/**
 * Taking orders or not (docs/SIPARIS_VE_SEVK.md, "Sipariş alma durumu"):
 * the state the customer sees, a pause for a while or until resumed, and
 * busy mode. Hidden while the order_availability module is off for the
 * restaurant; staff orders are never affected.
 */
export function AvailabilityBar({
  restaurantId,
  locale,
  canManage,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
}) {
  const t = useT(locale);
  const [state, setState] = useState<OrderAvailabilityDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `restaurants/${restaurantId}/availability`;

  const load = useCallback(() => {
    bffJson<OrderAvailabilityDTO>(path)
      .then(setState)
      .catch(() => undefined);
  }, [path]);

  useEffect(() => {
    load();
    // A pause or busy spell ends by itself; the bar follows without a reload.
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!state || !state.enabled) return null;

  const clock = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: state.timezone,
        }).format(new Date(iso))
      : '';

  const change = async (input: UpdateAvailabilityInput) => {
    setBusy(true);
    setError(null);
    try {
      setState(await bffJson<OrderAvailabilityDTO>(path, { method: 'PUT', body: JSON.stringify(input) }));
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  const tone = state.state === 'OPEN' ? 'success' : state.state === 'PAUSED' ? 'warn' : 'muted';
  return (
    <Card
      title={t('orders.availability.title')}
      aside={
        <Badge tone={tone} data-availability-state={state.state}>
          {t(`orders.availability.state.${state.state}`)}
        </Badge>
      }
      aria-label={t('orders.availability.title')}
    >
      <div className="flex flex-col gap-3">
        {state.state === 'PAUSED' && (
          <p className="ui-text-muted">{t('orders.availability.pausedUntil', { time: clock(state.pausedUntil) })}</p>
        )}
        {state.state === 'CLOSED' && state.nextOpenAt && (
          <p className="ui-text-muted">{t('orders.availability.nextOpen', { time: clock(state.nextOpenAt) })}</p>
        )}
        {state.busyExtraMinutes > 0 && (
          <p className="ui-text-muted">
            {t('orders.availability.busy', { minutes: state.busyExtraMinutes, time: clock(state.busyUntil) })}
          </p>
        )}
        {canManage && (
          <>
            {state.state === 'PAUSED' ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void change({ pause: null })} disabled={busy}>
                  {t('orders.availability.resume')}
                </Button>
              </div>
            ) : (
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label={t('orders.availability.pauseLabel')}
              >
                <span className="ui-caption">{t('orders.availability.pauseLabel')}</span>
                {PAUSE_MINUTE_CHOICES.map((minutes) => (
                  <Button
                    key={minutes}
                    variant="outline"
                    tone="warn"
                    onClick={() => void change({ pause: { minutes } })}
                    disabled={busy}
                  >
                    {t('orders.availability.pauseFor', { minutes })}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  tone="warn"
                  onClick={() => void change({ pause: { minutes: null } })}
                  disabled={busy}
                >
                  {t('orders.availability.pauseUntilResumed')}
                </Button>
              </div>
            )}
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label={t('orders.availability.busyLabel')}
            >
              <span className="ui-caption">{t('orders.availability.busyLabel')}</span>
              {BUSY_EXTRA_MINUTE_CHOICES.map((extraMinutes) => (
                <Button
                  key={extraMinutes}
                  variant={state.busyExtraMinutes === extraMinutes ? 'solid' : 'outline'}
                  tone="theme"
                  aria-pressed={state.busyExtraMinutes === extraMinutes}
                  onClick={() => void change({ busy: { extraMinutes, minutes: BUSY_SPELL_MINUTES } })}
                  disabled={busy}
                >
                  {t('orders.availability.busyFor', { minutes: extraMinutes })}
                </Button>
              ))}
              {state.busyExtraMinutes > 0 && (
                <Button variant="outline" tone="muted" onClick={() => void change({ busy: null })} disabled={busy}>
                  {t('orders.availability.busyOff')}
                </Button>
              )}
            </div>
            <p className="ui-caption">{t('orders.availability.staffNote')}</p>
          </>
        )}
        {error && (
          <p role="alert" className="ui-text-muted">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
