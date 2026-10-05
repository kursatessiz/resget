'use client';

import { useState } from 'react';
import type { PublicReviewsPageDTO } from '@resget/shared';
import { Button } from '@/components/ui';
import { bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * Every review of the restaurant, newest first (docs/YORUMLAR.md): the
 * score, the short name, the masked comment and the restaurant's answer.
 */
export function PublicReviews({
  slug,
  locale,
  initial,
}: {
  slug: string;
  locale: string;
  initial: PublicReviewsPageDTO;
}) {
  const t = useT(locale);
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  const more = async () => {
    if (!cursor) return;
    setBusy(true);
    try {
      const page = await bffJson<PublicReviewsPageDTO>(`public/restaurants/${slug}/reviews?cursor=${cursor}`);
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      // A failed page leaves the button in place for another try.
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-label={t('reviews.public.title')} data-public-reviews>
      <h2 className="ui-heading">{t('reviews.public.title')}</h2>
      {initial.summary && (
        <p className="ui-text-muted" data-reviews-summary>
          {t('reviews.public.summary', {
            average: decimal.format(initial.summary.average),
            count: initial.summary.count,
          })}
        </p>
      )}
      {items.length === 0 ? (
        <p className="ui-text-muted">{t('reviews.public.empty')}</p>
      ) : (
        <ul className="ui-divide">
          {items.map((review) => (
            <li key={review.id} className="flex flex-col gap-1 py-3" data-review={review.id}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="ui-heading">{t('reviews.score', { score: review.score })}</span>
                <span>{review.author ?? t('reviews.public.anonymous')}</span>
                <span className="ui-caption">
                  {date.format(new Date(review.createdAt))}
                  {review.editedAt ? ` (${t('reviews.public.edited')})` : ''}
                </span>
              </span>
              {review.comment && <p>{review.comment}</p>}
              {review.reply && (
                <div className="ui-rule flex flex-col gap-1 pt-2" data-review-reply>
                  <span className="ui-label">{t('reviews.public.reply')}</span>
                  <p className="ui-text-muted">{review.reply.body}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <div>
          <Button variant="outline" tone="muted" onClick={() => void more()} disabled={busy}>
            {t('reviews.public.more')}
          </Button>
        </div>
      )}
    </section>
  );
}
