'use client';

import { useState } from 'react';
import { CLAIM_NOTE_MAX, formatMoney } from '@resget/shared';
import type { OrderTrackingDTO, RefundItem, Translate } from '@resget/shared';
import { Button, Card, SelectField, TextAreaField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';

/**
 * The customer's missing-item report on the tracking page (docs/ODEME.md,
 * "Eksik ürün bildirimi"): which items did not arrive and how many, with an
 * optional note; then the restaurant's decision. Shown while a report can
 * be filed or once one exists.
 */
export function ClaimCard({
  token,
  tracking,
  locale,
  t,
  onUpdated,
}: {
  token: string;
  tracking: OrderTrackingDTO;
  locale: string;
  t: Translate;
  onUpdated: (next: OrderTrackingDTO) => void;
}) {
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { claim } = tracking;
  if (!claim && !tracking.canClaim) return null;
  const items: RefundItem[] = Object.entries(quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await bffJson<OrderTrackingDTO>(`public/orders/${encodeURIComponent(token)}/claims`, {
        method: 'POST',
        body: JSON.stringify({ items, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      onUpdated(next);
      setOpen(false);
      setQuantities({});
      setNote('');
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('tracking.claim.title')} aria-label={t('tracking.claim.title')}>
      <div className="flex flex-col gap-3">
        {claim && (
          <p role="status">
            {claim.status === 'OPEN'
              ? t('tracking.claim.open')
              : claim.status === 'APPROVED'
                ? t('tracking.claim.approved', {
                    amount: formatMoney({ amountMinor: claim.refundedMinor, currency: claim.currency }, locale),
                  })
                : t('tracking.claim.declined', { reason: claim.declineReason ?? '' })}
          </p>
        )}
        {tracking.canClaim &&
          (open ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <p className="ui-caption">{t('tracking.claim.intro')}</p>
              {tracking.items.map((item) => {
                const left = item.quantity - item.refundedQuantity;
                if (left <= 0) return null;
                return (
                  <SelectField
                    key={item.id}
                    id={`claim-${item.id}`}
                    label={t('tracking.claim.itemQuantity', { name: item.name, left })}
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
              <TextAreaField
                label={t('tracking.claim.note')}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={CLAIM_NOTE_MAX}
                rows={3}
              />
              {error && (
                <p role="alert" className="pui-alert pui-error">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || items.length === 0}>
                  {t('tracking.claim.submit')}
                </Button>
                <Button type="button" variant="outline" tone="muted" onClick={() => setOpen(false)} disabled={busy}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <Button variant="outline" tone="theme" onClick={() => setOpen(true)}>
                {t('tracking.claim.start')}
              </Button>
            </div>
          ))}
      </div>
    </Card>
  );
}
