'use client';

import { useEffect, useState } from 'react';
import { PARTIAL_REFUND_ORDER_STATUSES, formatMoney, itemsRefundMinor, parseMajorAmount } from '@resget/shared';
import type { OrderDetailDTO, OrderStatus, OrderSummaryDTO, RefundItem, Translate } from '@resget/shared';
import { Button, SelectField, TextField } from '@/components/ui';

type Mode = 'all' | 'items' | 'amount';

/** What the panel sends to the refund endpoint (RefundOrderSchema). */
export interface RefundRequest {
  reason: string;
  items?: RefundItem[];
  amountMinor?: number;
}

/**
 * The staff refund form (docs/ODEME.md, "Kısmi iade"): everything that is
 * left, chosen items at what the customer paid for them, or an amount; the
 * preview uses the same pricing as the API (itemsRefundMinor). A cancelled
 * order only gives everything back. Earlier refunds are listed with the
 * commission the platform gave back for each.
 */
export function RefundPanel({
  order,
  locale,
  t,
  busy,
  loadDetail,
  onSubmit,
  onCancel,
}: {
  order: OrderSummaryDTO;
  locale: string;
  t: Translate;
  busy: boolean;
  loadDetail: () => Promise<OrderDetailDTO>;
  onSubmit: (request: RefundRequest) => void;
  onCancel: () => void;
}) {
  const [detail, setDetail] = useState<OrderDetailDTO | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<Mode>('all');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    let live = true;
    loadDetail()
      .then((loaded) => live && setDetail(loaded))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // The order is fixed for the life of the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: order.currency }, locale);
  const partialAllowed = PARTIAL_REFUND_ORDER_STATUSES.includes(order.status as OrderStatus);
  const leftMinor = Math.max(0, order.chargedToCustomerMinor - order.payment.refundedMinor);
  const selection: RefundItem[] = Object.entries(quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
  const given = new Map(detail?.items.map((item) => [item.id, item.refundedQuantity]) ?? []);
  const itemsMinor =
    detail && selection.length > 0 ? (itemsRefundMinor(detail, detail.items, selection, given) ?? 0) : 0;
  const amountMinor = parseMajorAmount(amountText, order.currency) ?? 0;
  const previewMinor = mode === 'all' ? leftMinor : mode === 'items' ? itemsMinor : amountMinor;
  const valid =
    reason.trim() !== '' &&
    (mode === 'all' ||
      (mode === 'items' && itemsMinor > 0 && itemsMinor <= leftMinor) ||
      (mode === 'amount' && amountMinor > 0 && amountMinor <= leftMinor));

  const submit = () => {
    if (!valid) return;
    const base = { reason: reason.trim() };
    if (mode === 'items') onSubmit({ ...base, items: selection });
    else if (mode === 'amount') onSubmit({ ...base, amountMinor });
    else onSubmit(base);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="ui-caption">{t('orders.refundHint')}</p>
      {partialAllowed && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('orders.refundModeLabel')}>
          {(['all', 'items', 'amount'] as const).map((value) => (
            <Button
              key={value}
              variant={mode === value ? 'solid' : 'outline'}
              tone={mode === value ? 'theme' : 'muted'}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              disabled={busy}
            >
              {t(`orders.refundMode.${value}`)}
            </Button>
          ))}
        </div>
      )}
      {mode === 'items' &&
        (detail ? (
          <div className="flex flex-col gap-2">
            {detail.items.map((item) => {
              const left = item.quantity - item.refundedQuantity;
              if (left <= 0) return null;
              return (
                <SelectField
                  key={item.id}
                  id={`refund-item-${order.id}-${item.id}`}
                  label={t('orders.refundItemQuantity', { name: item.name, left })}
                  value={quantities[item.id] ?? 0}
                  onChange={(event) => setQuantities({ ...quantities, [item.id]: Number(event.target.value) })}
                >
                  {Array.from({ length: left + 1 }, (_, quantity) => (
                    <option key={quantity} value={quantity}>
                      {quantity}
                    </option>
                  ))}
                </SelectField>
              );
            })}
          </div>
        ) : (
          <p className="ui-caption">{failed ? t('common.error.network') : t('orders.refundLoading')}</p>
        ))}
      {mode === 'amount' && (
        <TextField
          id={`refund-amount-${order.id}`}
          label={t('orders.refundAmount')}
          help={t('orders.refundAmountMax', { amount: money(leftMinor) })}
          inputMode="decimal"
          value={amountText}
          onChange={(event) => setAmountText(event.target.value)}
        />
      )}
      <TextField
        id={`refund-reason-${order.id}`}
        label={t('orders.refundReason')}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={300}
      />
      <p className="ui-text-muted">{t('orders.refundPreview', { amount: money(previewMinor) })}</p>
      {partialAllowed && <p className="ui-caption">{t('orders.refundCommissionNote')}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={submit} disabled={busy || !valid} tone="error">
          {t('orders.refundConfirm')}
        </Button>
        <Button variant="outline" tone="muted" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
      {detail && detail.refunds.length > 0 && <RefundHistory detail={detail} locale={locale} t={t} />}
    </div>
  );
}

/** Earlier refunds of an order: when, how much, why, which items and the commission given back with each. */
export function RefundHistory({ detail, locale, t }: { detail: OrderDetailDTO; locale: string; t: Translate }) {
  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: detail.currency }, locale);
  return (
    <section className="flex flex-col gap-2" aria-label={t('orders.refundHistory')}>
      <span className="ui-heading">{t('orders.refundHistory')}</span>
      <ul className="ui-divide">
        {detail.refunds.map((refund) => (
          <li key={refund.id} className="flex flex-col gap-1 py-2">
            <span>
              {t('orders.refundHistoryLine', {
                time: time.format(new Date(refund.createdAt)),
                amount: money(refund.amountMinor),
                source: t(`orders.refundSource.${refund.source}`),
              })}
            </span>
            {refund.items.length > 0 && (
              <span className="ui-caption">
                {refund.items.map((item) => t('orders.refundHistoryItem', item)).join(', ')}
              </span>
            )}
            {refund.reason && <span className="ui-caption">{refund.reason}</span>}
            {refund.commissionMinor + refund.commissionVatMinor > 0 && (
              <span className="ui-caption">
                {t('orders.refundHistoryCommission', {
                  amount: money(refund.commissionMinor + refund.commissionVatMinor),
                })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
