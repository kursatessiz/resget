'use client';

import { useEffect, useState } from 'react';
import { formatMoney, itemsRefundMinor } from '@resget/shared';
import type { OrderClaimDTO, OrderDetailDTO, OrderSummaryDTO, RefundItem, Translate } from '@resget/shared';
import { Button, SelectField, TextField } from '@/components/ui';

export type ClaimDecision = { action: 'approve'; items: RefundItem[] } | { action: 'decline'; reason: string };

/**
 * The restaurant's view of a customer's missing-item report (docs/ODEME.md,
 * "Eksik ürün bildirimi"): what was reported, the customer's note, and
 * either an approval of all or part of it (paid out as a partial refund;
 * the preview uses the API's pricing) or a decline with a reason the
 * customer reads.
 */
export function ClaimReview({
  order,
  locale,
  t,
  busy,
  loadDetail,
  onDecide,
  onCancel,
}: {
  order: OrderSummaryDTO;
  locale: string;
  t: Translate;
  busy: boolean;
  loadDetail: () => Promise<OrderDetailDTO>;
  onDecide: (claimId: string, decision: ClaimDecision) => void;
  onCancel: () => void;
}) {
  const [detail, setDetail] = useState<OrderDetailDTO | null>(null);
  const [failed, setFailed] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    let live = true;
    loadDetail()
      .then((loaded) => {
        if (!live) return;
        setDetail(loaded);
        const claim = loaded.claims.find((c) => c.status === 'OPEN');
        if (claim) setQuantities(Object.fromEntries(claim.items.map((i) => [i.orderItemId, i.quantity])));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // The order is fixed for the life of the review.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  const claim: OrderClaimDTO | undefined = detail?.claims.find((c) => c.status === 'OPEN');
  if (!detail || !claim) {
    return <p className="ui-caption">{failed ? t('common.error.network') : t('orders.refundLoading')}</p>;
  }
  const items: RefundItem[] = claim.items
    .map((i) => ({ orderItemId: i.orderItemId, quantity: quantities[i.orderItemId] ?? 0 }))
    .filter((i) => i.quantity > 0);
  const given = new Map(detail.items.map((item) => [item.id, item.refundedQuantity]));
  const previewMinor = items.length > 0 ? (itemsRefundMinor(detail, detail.items, items, given) ?? 0) : 0;
  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: claim.currency }, locale);

  return (
    <div className="flex flex-col gap-3">
      <p className="ui-heading">{t('orders.claim.title')}</p>
      <p className="ui-caption">{t('orders.claim.requested', { amount: money(claim.requestedMinor) })}</p>
      {claim.note && <p>{claim.note}</p>}
      {declining ? (
        <>
          <TextField
            id={`claim-reason-${order.id}`}
            label={t('orders.claim.declineReason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              tone="error"
              disabled={busy || reason.trim() === ''}
              onClick={() => onDecide(claim.id, { action: 'decline', reason: reason.trim() })}
            >
              {t('orders.claim.declineConfirm')}
            </Button>
            <Button variant="outline" tone="muted" onClick={() => setDeclining(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
          </div>
        </>
      ) : (
        <>
          {claim.items.map((item) => (
            <SelectField
              key={item.orderItemId}
              id={`claim-item-${order.id}-${item.orderItemId}`}
              label={t('orders.claim.itemQuantity', { name: item.name, claimed: item.quantity })}
              value={quantities[item.orderItemId] ?? 0}
              onChange={(event) => setQuantities({ ...quantities, [item.orderItemId]: Number(event.target.value) })}
            >
              {Array.from({ length: item.quantity + 1 }, (_, quantity) => (
                <option key={quantity} value={quantity}>
                  {quantity}
                </option>
              ))}
            </SelectField>
          ))}
          <p className="ui-text-muted">{t('orders.refundPreview', { amount: money(previewMinor) })}</p>
          <p className="ui-caption">{t('orders.refundCommissionNote')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              tone="success"
              disabled={busy || items.length === 0}
              onClick={() => onDecide(claim.id, { action: 'approve', items })}
            >
              {t('orders.claim.approve')}
            </Button>
            <Button variant="outline" tone="error" onClick={() => setDeclining(true)} disabled={busy}>
              {t('orders.claim.decline')}
            </Button>
            <Button variant="outline" tone="muted" onClick={onCancel} disabled={busy}>
              {t('common.cancel')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
