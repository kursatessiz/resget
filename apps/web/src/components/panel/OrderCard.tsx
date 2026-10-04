'use client';

import { useState } from 'react';
import { formatMoney } from '@resget/shared';
import type { OrderDetailDTO, OrderStatusValue, OrderSummaryDTO, Translate } from '@resget/shared';
import { Badge, Button, SelectField, TextField } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { RefundPanel } from './RefundPanel';
import type { RefundRequest } from './RefundPanel';

export interface OrderAction {
  to: OrderStatusValue;
  label: string;
  tone?: UiTone;
  needsPrep?: boolean;
  needsReason?: boolean;
}

const STATUS_TONE: Partial<Record<OrderStatusValue, UiTone>> = {
  PENDING_PAYMENT: 'warn',
  PLACED: 'theme',
  ACCEPTED: 'theme',
  PREPARING: 'warn',
  READY: 'success',
  HANDED_TO_COURIER: 'success',
  OUT_FOR_DELIVERY: 'success',
  ARRIVING: 'success',
  DELIVERED: 'muted',
  PICKED_UP: 'muted',
  CANCELLED_BY_CUSTOMER: 'error',
  CANCELLED_BY_RESTAURANT: 'error',
  REJECTED: 'error',
  REFUNDED: 'error',
};

const PREP_OPTIONS = [10, 15, 20, 25, 30, 40, 50, 60];

/** Which transitions the restaurant screen offers for an order (the state machine on the API is the authority). */
export function actionsFor(order: OrderSummaryDTO, t: Translate): OrderAction[] {
  if (order.activeTrip) return [];
  switch (order.status) {
    case 'PLACED':
      return [
        { to: 'ACCEPTED', label: t('orders.accept'), needsPrep: true },
        { to: 'REJECTED', label: t('orders.reject'), tone: 'error', needsReason: true },
      ];
    case 'ACCEPTED':
      return [
        { to: 'PREPARING', label: t('orders.markPreparing') },
        { to: 'READY', label: t('orders.markReady') },
        { to: 'CANCELLED_BY_RESTAURANT', label: t('orders.cancel'), tone: 'error', needsReason: true },
      ];
    case 'PREPARING':
      return [
        { to: 'READY', label: t('orders.markReady') },
        { to: 'CANCELLED_BY_RESTAURANT', label: t('orders.cancel'), tone: 'error', needsReason: true },
      ];
    case 'READY':
      if (order.fulfillment === 'PICKUP') return [{ to: 'PICKED_UP', label: t('orders.markPickedUp') }];
      if (order.fulfillment === 'DINE_IN') return [{ to: 'DELIVERED', label: t('orders.markServed') }];
      return [
        { to: 'OUT_FOR_DELIVERY', label: t('orders.markOutForDelivery') },
        { to: 'CANCELLED_BY_RESTAURANT', label: t('orders.cancel'), tone: 'error', needsReason: true },
      ];
    case 'OUT_FOR_DELIVERY':
    case 'ARRIVING':
      return [
        { to: 'DELIVERED', label: t('orders.markDelivered') },
        { to: 'READY', label: t('orders.returnToReady'), tone: 'warn' },
      ];
    default:
      return [];
  }
}

export function OrderCard({
  order,
  locale,
  t,
  canManage,
  canRefund = false,
  busy,
  onTransition,
  onRefund,
  loadDetail,
}: {
  order: OrderSummaryDTO;
  locale: string;
  t: Translate;
  canManage: boolean;
  /** The member holds orders.refund; the API still decides whether this order can be refunded. */
  canRefund?: boolean;
  busy: boolean;
  onTransition: (
    order: OrderSummaryDTO,
    to: OrderStatusValue,
    extra: { prepMinutes?: number; reason?: string },
  ) => void;
  onRefund?: (order: OrderSummaryDTO, request: RefundRequest) => void;
  /** The full order (items and earlier refunds) for the refund form. */
  loadDetail?: (order: OrderSummaryDTO) => Promise<OrderDetailDTO>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<OrderAction | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [prepMinutes, setPrepMinutes] = useState(20);
  const [reason, setReason] = useState('');
  const minutesAgo = Math.max(0, Math.round((Date.now() - new Date(order.placedAt).getTime()) / 60_000));
  const acceptLeft =
    order.status === 'PLACED' && order.acceptDeadlineAt
      ? Math.ceil((new Date(order.acceptDeadlineAt).getTime() - Date.now()) / 60_000)
      : null;
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const actions = canManage ? actionsFor(order, t) : [];
  const { refundState, refundFailureCode, refundable } = order.payment;
  const offerRefund = canRefund && Boolean(onRefund) && Boolean(loadDetail) && refundable;
  const partlyRefunded = refundState === 'NONE' && order.payment.refundedMinor > 0;

  const run = (action: OrderAction) => {
    if (action.needsPrep || action.needsReason) {
      setPending(action);
      return;
    }
    onTransition(order, action.to, {});
  };
  const confirm = () => {
    if (!pending) return;
    onTransition(order, pending.to, {
      prepMinutes: pending.needsPrep ? prepMinutes : undefined,
      reason: pending.needsReason ? reason.trim() || undefined : undefined,
    });
    setPending(null);
    setReason('');
  };

  return (
    <article className="pui-card" data-order-code={order.shortCode}>
      <div className="pui-card-content flex flex-col gap-3">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ui-heading">{t('orders.shortCode', { code: order.shortCode })}</span>
            <Badge tone={STATUS_TONE[order.status] ?? 'muted'}>{t(`orders.status.${order.status}`)}</Badge>
            <Badge>{t(`orders.fulfillment.${order.fulfillment}`)}</Badge>
            {order.tableLabel && <Badge>{t('orders.table', { label: order.tableLabel })}</Badge>}
            {acceptLeft !== null &&
              (acceptLeft > 0 ? (
                <Badge tone="warn">{t('orders.acceptWithin', { minutes: acceptLeft })}</Badge>
              ) : (
                <Badge tone="error">{t('orders.acceptOverdue')}</Badge>
              ))}
            {order.activeTrip && (
              <Badge tone="theme">{t('orders.inTrip', { sequence: order.activeTrip.sequence })}</Badge>
            )}
          </div>
          <span className="ui-caption">
            {minutesAgo === 0 ? t('orders.placedJustNow') : t('orders.placedAgo', { minutes: minutesAgo })}
          </span>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="ui-text-muted">
            {order.customer.fullName ?? t('orders.customer')}
            {order.customer.phone ? ` ${order.customer.phone}` : ''}
          </span>
          <span className="ui-price">
            {t('orders.itemCount', { count: order.itemCount })} /{' '}
            {formatMoney({ amountMinor: order.chargedToCustomerMinor, currency: order.currency }, locale)}
          </span>
        </div>

        {order.address && <p className="ui-caption">{order.address.addressLine}</p>}
        {order.note && (
          <p className="ui-caption">
            {t('orders.note')}: {order.note}
          </p>
        )}
        {order.payment.method && (
          <p className="ui-caption">
            {t(`payments.method.${order.payment.method}`)}
            {order.payment.providerCode && order.payment.method === 'MEAL_CARD'
              ? ` (${order.payment.providerCode})`
              : ''}
            {' - '}
            {order.status === 'PENDING_PAYMENT'
              ? t('orders.awaitingPayment')
              : order.payment.dueMinor > 0
                ? t('orders.paymentDue', {
                    amount: formatMoney({ amountMinor: order.payment.dueMinor, currency: order.currency }, locale),
                  })
                : t('orders.paid')}
          </p>
        )}
        {partlyRefunded && (
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone="warn">
              {t('orders.refundState.PARTIAL', {
                amount: formatMoney({ amountMinor: order.payment.refundedMinor, currency: order.currency }, locale),
              })}
            </Badge>
          </p>
        )}
        {refundState !== 'NONE' && (
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={refundState === 'DONE' ? 'muted' : refundState === 'FAILED' ? 'error' : 'warn'}>
              {refundState === 'DONE'
                ? t('orders.refundState.DONE', {
                    amount: formatMoney({ amountMinor: order.payment.refundedMinor, currency: order.currency }, locale),
                  })
                : t(`orders.refundState.${refundState}`)}
            </Badge>
            {refundState === 'FAILED' && refundFailureCode && (
              <span className="ui-caption">{t(`errors.${refundFailureCode}`)}</span>
            )}
          </p>
        )}
        {order.promisedReadyAt && ['ACCEPTED', 'PREPARING'].includes(order.status) && (
          <p className="ui-caption">
            {t('orders.promisedReadyAt')}: {time.format(new Date(order.promisedReadyAt))}
          </p>
        )}

        {refunding && onRefund && loadDetail ? (
          <RefundPanel
            order={order}
            locale={locale}
            t={t}
            busy={busy}
            loadDetail={() => loadDetail(order)}
            onSubmit={(request) => {
              onRefund(order, request);
              setRefunding(false);
            }}
            onCancel={() => setRefunding(false)}
          />
        ) : pending ? (
          <div className="flex flex-col gap-3">
            {pending.needsPrep && (
              <SelectField
                id={`prep-${order.id}`}
                label={t('orders.prepMinutes')}
                value={prepMinutes}
                onChange={(event) => setPrepMinutes(Number(event.target.value))}
              >
                {PREP_OPTIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {t('orders.prepMinutesOption', { minutes })}
                  </option>
                ))}
              </SelectField>
            )}
            {pending.needsReason && (
              <TextField
                id={`reason-${order.id}`}
                label={t('orders.reasonPrompt')}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={300}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={confirm} disabled={busy} tone={pending.tone ?? 'theme'}>
                {pending.label}
              </Button>
              <Button variant="outline" tone="muted" onClick={() => setPending(null)} disabled={busy}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((action) => (
              <Button
                key={action.to}
                onClick={() => run(action)}
                disabled={busy}
                variant={action.tone === 'error' || action.tone === 'warn' ? 'outline' : 'solid'}
                tone={action.tone ?? 'theme'}
              >
                {action.label}
              </Button>
            ))}
            {offerRefund && (
              <Button variant="outline" tone="error" onClick={() => setRefunding(true)} disabled={busy}>
                {refundState === 'FAILED' ? t('orders.refundRetry') : t('orders.refund')}
              </Button>
            )}
            <Button variant="link" tone="muted" onClick={() => setOpen((v) => !v)}>
              {open ? t('orders.hideDetails') : t('orders.showDetails')}
            </Button>
          </div>
        )}

        {open && (
          <dl className="ui-divide">
            <div className="flex justify-between gap-4 py-2">
              <dt className="ui-text-muted">{t('orders.channel.' + order.channel)}</dt>
              <dd>{time.format(new Date(order.placedAt))}</dd>
            </div>
            {order.address && (
              <div className="flex justify-between gap-4 py-2">
                <dt className="ui-text-muted">{t('orders.address')}</dt>
                <dd className="text-right">
                  {order.address.addressLine}, {order.address.district}
                  {order.address.note ? ` (${order.address.note})` : ''}
                </dd>
              </div>
            )}
            {order.estimatedDeliveryAt && (
              <div className="flex justify-between gap-4 py-2">
                <dt className="ui-text-muted">{t('orders.estimatedDeliveryAt')}</dt>
                <dd>{time.format(new Date(order.estimatedDeliveryAt))}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </article>
  );
}
