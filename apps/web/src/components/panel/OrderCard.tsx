'use client';

import { useState } from 'react';
import {
  ORDER_PREP_OPTIONS,
  courierCallActions,
  formatMoney,
  isActiveDeliveryRequest,
  orderActionsFor,
} from '@resget/shared';
import type { OrderDetailDTO, OrderStatusValue, OrderSummaryDTO, Translate } from '@resget/shared';
import { Badge, Button, LinkButton, SelectField, TextField } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { RefundPanel } from './RefundPanel';
import type { RefundRequest } from './RefundPanel';
import { ClaimReview } from './ClaimReview';
import type { ClaimDecision } from './ClaimReview';

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

/** Which transitions the restaurant screen offers for an order (shared table; the API's state machine is the authority). */
export function actionsFor(order: OrderSummaryDTO, t: Translate): OrderAction[] {
  return orderActionsFor(order).map((action) => ({
    to: action.to,
    label: t(action.labelKey),
    tone: action.tone,
    needsPrep: action.needsPrep,
    needsReason: action.needsReason,
  }));
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
  onClaim,
  loadDetail,
  courierNetwork = null,
  onCourier,
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
  /** Decides the customer's missing-item report (approve all or part of it, or decline with a reason). */
  onClaim?: (order: OrderSummaryDTO, claimId: string, decision: ClaimDecision) => void;
  /** The full order (items and earlier refunds) for the refund form. */
  loadDetail?: (order: OrderSummaryDTO) => Promise<OrderDetailDTO>;
  /** The restaurant's courier network when a call is possible (docs/KURYE.md); null hides the call. */
  courierNetwork?: string | null;
  /** Calls the network for this order or calls it off; set for members holding dispatch.manage. */
  onCourier?: (order: OrderSummaryDTO, action: 'call' | 'cancel') => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<OrderAction | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [reviewing, setReviewing] = useState(false);
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
  const offerClaim = canRefund && Boolean(onClaim) && Boolean(loadDetail) && order.openClaimId !== null;
  const request = order.courierRequest;
  const courierActions = courierCallActions(order, courierNetwork !== null);
  const offerCall = Boolean(onCourier) && courierActions.call;
  const offerCallOff = Boolean(onCourier) && courierActions.cancel;

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
            {order.tabId && (
              <Badge tone="muted" data-order-tab>
                {t('tab.order.badge')}
              </Badge>
            )}
            {acceptLeft !== null &&
              (acceptLeft > 0 ? (
                <Badge tone="warn">{t('orders.acceptWithin', { minutes: acceptLeft })}</Badge>
              ) : (
                <Badge tone="error">{t('orders.acceptOverdue')}</Badge>
              ))}
            {order.activeTrip && (
              <Badge tone="theme">{t('orders.inTrip', { sequence: order.activeTrip.sequence })}</Badge>
            )}
            {order.openClaimId && <Badge tone="warn">{t('orders.claim.badge')}</Badge>}
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
        {(request || offerCall) && (
          <div className="flex flex-wrap items-center gap-2" data-courier-request={request?.status ?? 'NONE'}>
            {request && (
              <Badge
                tone={
                  isActiveDeliveryRequest(request.status) ? 'theme' : request.status === 'DELIVERED' ? 'muted' : 'warn'
                }
              >
                {t('courier.call.label', {
                  provider: request.providerName,
                  status: t(`courier.requests.status.${request.status}`),
                })}
              </Badge>
            )}
            {request && isActiveDeliveryRequest(request.status) && request.pickupEtaMinutes !== null && (
              <span className="ui-caption">
                {t('courier.call.eta', { pickup: request.pickupEtaMinutes, dropoff: request.dropoffEtaMinutes ?? 0 })}
              </span>
            )}
            {request?.trackingUrl && isActiveDeliveryRequest(request.status) && (
              <LinkButton
                href={request.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                variant="soft"
                tone="muted"
              >
                {t('courier.call.track')}
              </LinkButton>
            )}
            {offerCall && (
              <Button variant="outline" disabled={busy} onClick={() => onCourier?.(order, 'call')}>
                {t('courier.call.button')}
              </Button>
            )}
            {offerCallOff && (
              <Button variant="outline" tone="error" disabled={busy} onClick={() => onCourier?.(order, 'cancel')}>
                {t('courier.call.cancel')}
              </Button>
            )}
          </div>
        )}
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
        {order.source && (
          <p data-order-source={order.source}>
            <Badge tone="muted">{t('orders.source', { source: t(`orderingLinks.source.${order.source}`) })}</Badge>
          </p>
        )}
        {order.scheduledFor && (
          <p data-scheduled-for>
            <Badge tone="theme">
              {t('orders.scheduledFor', {
                time: new Intl.DateTimeFormat(locale, {
                  weekday: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(order.scheduledFor)),
              })}
            </Badge>
          </p>
        )}
        {order.promisedReadyAt && ['ACCEPTED', 'PREPARING'].includes(order.status) && (
          <p className="ui-caption">
            {t('orders.promisedReadyAt')}: {time.format(new Date(order.promisedReadyAt))}
          </p>
        )}

        {reviewing && onClaim && loadDetail ? (
          <ClaimReview
            order={order}
            locale={locale}
            t={t}
            busy={busy}
            loadDetail={() => loadDetail(order)}
            onDecide={(claimId, decision) => {
              onClaim(order, claimId, decision);
              setReviewing(false);
            }}
            onCancel={() => setReviewing(false)}
          />
        ) : refunding && onRefund && loadDetail ? (
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
                {ORDER_PREP_OPTIONS.map((minutes) => (
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
            {offerClaim && (
              <Button tone="warn" onClick={() => setReviewing(true)} disabled={busy}>
                {t('orders.claim.review')}
              </Button>
            )}
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
