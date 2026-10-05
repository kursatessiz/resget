'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ADMIN_REVIEW_FILTERS } from '@resget/shared';
import type { AdminReviewDTO, ReviewDecision } from '@resget/shared';
import { Badge, Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

type Filter = (typeof ADMIN_REVIEW_FILTERS)[number];

/** Review moderation (docs/YORUMLAR.md): reported reviews to take down or leave up, and taken down ones to restore. */
export function AdminReviews({ locale }: { locale: string }) {
  const t = useT(locale);
  const [filter, setFilter] = useState<Filter>('REPORTED');
  const [items, setItems] = useState<AdminReviewDTO[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const load = useCallback(
    (which: Filter) => bffJson<AdminReviewDTO[]>(`admin/reviews?status=${which}`).then(setItems).catch(fail),
    [fail],
  );

  useEffect(() => {
    setItems(null);
    void load(filter);
  }, [filter, load]);

  const decide = async (id: string, action: ReviewDecision) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await bffJson<AdminReviewDTO>(`admin/reviews/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ action, note: notes[id]?.trim() || null }),
      });
      setNotice(t('reviews.admin.done'));
      await load(filter);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('reviews.admin.title')}</h1>
        <p className="ui-text-muted">{t('reviews.admin.intro')}</p>
      </header>
      <fieldset className="flex flex-wrap gap-4" aria-label={t('reviews.admin.title')}>
        {ADMIN_REVIEW_FILTERS.map((f) => (
          <label key={f} className="flex items-center gap-2">
            <input
              type="radio"
              className="pui-radio"
              name="review-filter"
              checked={filter === f}
              onChange={() => setFilter(f)}
            />
            <span>{t(`reviews.admin.filter.${f}`)}</span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="ui-caption">
          {notice}
        </p>
      )}
      {!items ? (
        <p className="ui-text-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="ui-text-muted">{t('reviews.admin.empty')}</p>
      ) : (
        items.map((review) => (
          <Card
            key={review.id}
            aria-label={review.restaurant.name}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <Link href={`/admin/restoranlar/${review.restaurant.id}`} className="pui-btn pui-link pui-theme">
                  {review.restaurant.name}
                </Link>
                <Badge>{t('reviews.score', { score: review.score })}</Badge>
                <span className="ui-caption">{date.format(new Date(review.createdAt))}</span>
              </span>
            }
          >
            <div className="flex flex-col gap-2" data-admin-review={review.orderShortCode}>
              <p>{review.comment ?? t('reviews.public.anonymous')}</p>
              {review.report && (
                <p className="ui-caption">
                  {t('reviews.admin.reported', { reason: t(`reviews.reason.${review.report.reason}`) })}
                  {review.report.note ? ` / ${review.report.note}` : ''}
                </p>
              )}
              {review.reply && <p className="ui-text-muted">{review.reply.body}</p>}
              <TextField
                id={`decision-note-${review.id}`}
                label={t('reviews.admin.note')}
                value={notes[review.id] ?? ''}
                maxLength={300}
                onChange={(e) => setNotes({ ...notes, [review.id]: e.target.value })}
              />
              <div className="flex flex-wrap gap-2">
                {filter === 'REPORTED' ? (
                  <>
                    <Button tone="error" onClick={() => void decide(review.id, 'HIDE')} disabled={busy}>
                      {t('reviews.admin.hide')}
                    </Button>
                    <Button
                      variant="outline"
                      tone="muted"
                      onClick={() => void decide(review.id, 'DISMISS')}
                      disabled={busy}
                    >
                      {t('reviews.admin.dismiss')}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    tone="muted"
                    onClick={() => void decide(review.id, 'RESTORE')}
                    disabled={busy}
                  >
                    {t('reviews.admin.restore')}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))
      )}
    </>
  );
}
