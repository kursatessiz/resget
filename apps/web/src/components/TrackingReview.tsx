'use client';

import { useState } from 'react';
import { RATING_COMMENT_MAX, RATING_MAX, RATING_MIN } from '@resget/shared';
import type { OrderRatingDTO, OrderTrackingDTO, Translate } from '@resget/shared';
import { Button, TextAreaField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';

/**
 * The customer's review on the tracking page once given (docs/YORUMLAR.md):
 * the score and comment, the restaurant's public answer, and an edit form
 * while the one-day window is open.
 */
export function TrackingReview({
  token,
  rating,
  locale,
  thanked,
  t,
  onUpdated,
}: {
  token: string;
  rating: OrderRatingDTO;
  locale: string;
  thanked: boolean;
  t: Translate;
  onUpdated: (next: OrderTrackingDTO) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [score, setScore] = useState(rating.score);
  const [comment, setComment] = useState(rating.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const scores = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await bffJson<OrderTrackingDTO>(`public/orders/${encodeURIComponent(token)}/rating`, {
        method: 'PATCH',
        body: JSON.stringify({ score, comment: comment.trim() ? comment.trim() : null }),
      });
      onUpdated(next);
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form
        className="flex flex-col gap-3"
        aria-label={t('reviews.edit.button')}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset className="flex flex-wrap gap-3">
          <legend className="ui-heading">{t('tracking.rating.score')}</legend>
          {scores.map((value) => (
            <label key={value} className="flex items-center gap-1">
              <input
                type="radio"
                className="pui-radio"
                name="rating-edit"
                value={value}
                checked={score === value}
                onChange={() => setScore(value)}
                aria-label={t('tracking.rating.star', { count: value })}
              />
              <span>{value}</span>
            </label>
          ))}
        </fieldset>
        <TextAreaField
          label={t('tracking.rating.comment')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={RATING_COMMENT_MAX}
          rows={3}
        />
        <p className="ui-caption">{t('reviews.edit.publicNote')}</p>
        {error && (
          <p role="alert" className="pui-alert pui-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {t('reviews.edit.save')}
          </Button>
          <Button type="button" variant="outline" tone="muted" onClick={() => setEditing(false)}>
            {t('reviews.edit.cancel')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-tracking-review>
      <p role="status">
        {saved ? `${t('reviews.edit.saved')} ` : thanked ? `${t('tracking.rating.thanks')} ` : ''}
        {t('tracking.rating.given', { score: rating.score })}
      </p>
      {rating.comment && <p className="ui-text-muted">{rating.comment}</p>}
      {rating.reply && (
        <div className="flex flex-col gap-1" data-tracking-reply>
          <span className="ui-label">{t('reviews.public.reply')}</span>
          <p>{rating.reply.body}</p>
        </div>
      )}
      {rating.editableUntil && (
        <div className="flex flex-col gap-1">
          <p className="ui-caption">{t('reviews.edit.until', { date: date.format(new Date(rating.editableUntil)) })}</p>
          <div>
            <Button variant="outline" tone="muted" onClick={() => setEditing(true)}>
              {t('reviews.edit.button')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
