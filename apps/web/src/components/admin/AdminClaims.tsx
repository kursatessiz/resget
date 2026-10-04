'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatMoney } from '@resget/shared';
import type { AdminClaimDTO } from '@resget/shared';
import { Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * Escalated missing-item claims (docs/ODEME.md, "Eksik ürün bildirimi"):
 * reports the restaurant did not decide in time. The console approves (a
 * partial refund charged to the restaurant, commission share returned) or
 * declines with a reason the customer reads; the customer's claims across
 * the platform help spot abuse.
 */
export function AdminClaims({ locale }: { locale: string }) {
  const t = useT(locale);
  const [claims, setClaims] = useState<AdminClaimDTO[] | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    bffJson<AdminClaimDTO[]>('admin/claims').then(setClaims).catch(fail);
  }, [fail]);

  const decide = async (claimId: string, action: 'approve' | 'decline') => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = action === 'approve' ? {} : { reason: reason.trim() };
      setClaims(
        await bffJson<AdminClaimDTO[]>(`admin/claims/${claimId}/${action}`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
      setDeclining(null);
      setReason('');
      setNotice(t('admin.claims.done'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const time = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="ui-title">{t('admin.claims.title')}</h1>
      <p className="ui-text-muted">{t('admin.claims.intro')}</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {claims && claims.length === 0 && <p className="ui-text-muted">{t('admin.claims.empty')}</p>}
      {claims?.map((claim) => (
        <Card
          key={claim.id}
          title={t('admin.claims.order', { restaurant: claim.restaurantName, code: claim.orderShortCode })}
          data-claim={claim.id}
        >
          <div className="flex flex-col gap-2">
            <Link href={`/admin/restoranlar/${claim.restaurantId}`} className="ui-caption">
              {claim.restaurantSlug}
            </Link>
            <span>{claim.items.map((i) => `${i.quantity} x ${i.name}`).join(', ')}</span>
            <span className="ui-caption">
              {t('admin.claims.requested', {
                amount: formatMoney({ amountMinor: claim.requestedMinor, currency: claim.currency }, locale),
              })}
            </span>
            <span className="ui-caption">{t('admin.claims.filed', { time: time(claim.createdAt) })}</span>
            {claim.note && <p>{claim.note}</p>}
            <p className="ui-caption" data-claim-history>
              {t('admin.claims.history', {
                days: claim.platformHistory.windowDays,
                claims: claim.platformHistory.claims,
                approved: claim.platformHistory.approved,
              })}
            </p>
            {declining === claim.id ? (
              <div className="flex flex-col gap-2">
                <TextField
                  id={`admin-claim-reason-${claim.id}`}
                  label={t('admin.claims.reason')}
                  value={reason}
                  maxLength={300}
                  onChange={(event) => setReason(event.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    tone="error"
                    disabled={busy || reason.trim() === ''}
                    onClick={() => void decide(claim.id, 'decline')}
                  >
                    {t('admin.claims.declineConfirm')}
                  </Button>
                  <Button variant="outline" tone="muted" onClick={() => setDeclining(null)} disabled={busy}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button tone="success" disabled={busy} onClick={() => void decide(claim.id, 'approve')}>
                  {t('admin.claims.approve')}
                </Button>
                <Button variant="outline" tone="error" disabled={busy} onClick={() => setDeclining(claim.id)}>
                  {t('admin.claims.decline')}
                </Button>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
