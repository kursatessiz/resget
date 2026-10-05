'use client';

import { useCallback, useEffect, useState } from 'react';
import { REVIEW_REPLY_MAX, REVIEW_REPORT_REASONS } from '@resget/shared';
import type { PanelReviewDTO, PanelReviewsPageDTO, ReviewReportReason } from '@resget/shared';
import { Badge, Button, SelectField, TextAreaField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** Reviews as written, the public answer (editable for a day) and the report to the platform (docs/YORUMLAR.md). */
export function ReviewsPanel({
  restaurantId,
  locale,
  canManage,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/reviews`;
  const [items, setItems] = useState<PanelReviewDTO[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    bffJson<PanelReviewsPageDTO>(base)
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch(fail);
  }, [base, fail]);

  const more = () => {
    if (!cursor) return;
    bffJson<PanelReviewsPageDTO>(`${base}?cursor=${cursor}`)
      .then((page) => {
        setItems((current) => [...(current ?? []), ...page.items]);
        setCursor(page.nextCursor);
      })
      .catch(fail);
  };

  const replace = (next: PanelReviewDTO) =>
    setItems((current) => (current ?? []).map((item) => (item.id === next.id ? next : item)));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('reviews.panel.title')}</h1>
        <p className="ui-text-muted">{t('reviews.panel.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}
      {!items ? (
        <p className="ui-text-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="ui-text-muted">{t('reviews.panel.empty')}</p>
      ) : (
        <ul className="ui-divide">
          {items.map((review) => (
            <ReviewItem
              key={review.id}
              review={review}
              base={base}
              locale={locale}
              canManage={canManage}
              onChanged={replace}
            />
          ))}
        </ul>
      )}
      {cursor && (
        <div>
          <Button variant="outline" tone="muted" onClick={more}>
            {t('reviews.panel.more')}
          </Button>
        </div>
      )}
    </div>
  );
}

function ReviewItem({
  review,
  base,
  locale,
  canManage,
  onChanged,
}: {
  review: PanelReviewDTO;
  base: string;
  locale: string;
  canManage: boolean;
  onChanged: (next: PanelReviewDTO) => void;
}) {
  const t = useT(locale);
  const [reply, setReply] = useState(review.reply?.body ?? '');
  const [editingReply, setEditingReply] = useState(review.reply === null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<ReviewReportReason>('OFFENSIVE');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const run = async (action: () => Promise<PanelReviewDTO>, done: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await action();
      onChanged(next);
      setNotice(done);
      return next;
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveReply = async () => {
    const next = await run(
      () =>
        bffJson<PanelReviewDTO>(`${base}/${review.id}/reply`, {
          method: 'PUT',
          body: JSON.stringify({ body: reply.trim() }),
        }),
      t('reviews.panel.reply.saved'),
    );
    if (next) setEditingReply(false);
  };

  const report = async () => {
    const next = await run(
      () =>
        bffJson<PanelReviewDTO>(`${base}/${review.id}/report`, {
          method: 'POST',
          body: JSON.stringify({ reason, note: note.trim() || null }),
        }),
      t('reviews.panel.report.sent'),
    );
    if (next) setReporting(false);
  };

  return (
    <li className="flex flex-col gap-2 py-3" data-panel-review={review.orderShortCode}>
      <span className="flex flex-wrap items-center gap-2">
        <span className="ui-heading">{t('reviews.score', { score: review.score })}</span>
        <span>{review.author ?? t('reviews.public.anonymous')}</span>
        <span className="ui-caption">
          {t('reviews.panel.order', { code: review.orderShortCode })} / {date.format(new Date(review.createdAt))}
        </span>
        {review.hiddenAt && <Badge tone="error">{t('reviews.panel.hidden')}</Badge>}
        {review.report && !review.report.resolvedAt && <Badge tone="warn">{t('reviews.panel.report.pending')}</Badge>}
        {review.report?.resolvedAt && !review.hiddenAt && (
          <Badge tone="muted">{t('reviews.panel.report.resolved')}</Badge>
        )}
      </span>
      {review.comment && <p>{review.comment}</p>}

      {review.reply && !editingReply && (
        <div className="flex flex-col gap-1" data-panel-reply>
          <span className="ui-label">{t('reviews.public.reply')}</span>
          <p className="ui-text-muted">{review.reply.body}</p>
          {review.replyEditableUntil && review.canReply && (
            <span className="ui-caption">
              {t('reviews.panel.reply.until', { date: date.format(new Date(review.replyEditableUntil)) })}
            </span>
          )}
          {!review.canReply && <span className="ui-caption">{t('reviews.panel.reply.locked')}</span>}
          {canManage && review.canReply && (
            <div>
              <Button variant="link" tone="muted" onClick={() => setEditingReply(true)}>
                {t('reviews.panel.reply.edit')}
              </Button>
            </div>
          )}
        </div>
      )}

      {canManage && editingReply && review.canReply && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveReply();
          }}
        >
          <TextAreaField
            id={`reply-${review.id}`}
            label={t('reviews.panel.reply.label')}
            value={reply}
            maxLength={REVIEW_REPLY_MAX}
            rows={3}
            onChange={(e) => setReply(e.target.value)}
          />
          <div>
            <Button type="submit" disabled={busy || reply.trim().length === 0}>
              {t('reviews.panel.reply.save')}
            </Button>
          </div>
        </form>
      )}

      {canManage && !review.report && !reporting && (
        <div>
          <Button variant="link" tone="muted" onClick={() => setReporting(true)}>
            {t('reviews.panel.report.button')}
          </Button>
        </div>
      )}
      {canManage && reporting && (
        <form
          className="grid gap-2 md:grid-cols-2"
          aria-label={t('reviews.panel.report.button')}
          onSubmit={(event) => {
            event.preventDefault();
            void report();
          }}
        >
          <SelectField
            id={`report-reason-${review.id}`}
            label={t('reviews.panel.report.reason')}
            value={reason}
            onChange={(e) => setReason(e.target.value as ReviewReportReason)}
          >
            {REVIEW_REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`reviews.reason.${r}`)}
              </option>
            ))}
          </SelectField>
          <TextField
            id={`report-note-${review.id}`}
            label={t('reviews.panel.report.note')}
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy}>
              {t('reviews.panel.report.submit')}
            </Button>
          </div>
        </form>
      )}
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
    </li>
  );
}
