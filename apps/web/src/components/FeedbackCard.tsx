'use client';

import { useState } from 'react';
import { NPS_MAX, NPS_MIN } from '@resget/shared';
import type { OrderTrackingDTO, Translate } from '@resget/shared';
import { Button, Card, LinkButton, TextAreaField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';

/**
 * After the rating on the tracking page (docs/GERI_BILDIRIM.md): the
 * restaurant's review page for every rater alike, never depending on the
 * score, and the one NPS question.
 */
export function FeedbackCard({
  token,
  tracking,
  t,
  onUpdated,
}: {
  token: string;
  tracking: OrderTrackingDTO;
  t: Translate;
  onUpdated: (next: OrderTrackingDTO) => void;
}) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!tracking.reviewUrl && !tracking.canAnswerNps && !tracking.nps) return null;

  const submit = async () => {
    if (score === null) return;
    setBusy(true);
    setError(null);
    try {
      onUpdated(
        await bffJson<OrderTrackingDTO>(`public/orders/${encodeURIComponent(token)}/nps`, {
          method: 'POST',
          body: JSON.stringify({ score, ...(comment.trim() ? { comment: comment.trim() } : {}) }),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };
  const values = Array.from({ length: NPS_MAX - NPS_MIN + 1 }, (_, i) => NPS_MIN + i);

  return (
    <Card title={t('feedback.tracking.npsTitle')} aria-label={t('feedback.tracking.npsTitle')}>
      {tracking.reviewUrl && (
        <div className="flex flex-col gap-2" data-review-link>
          <p className="ui-caption">{t('feedback.tracking.reviewIntro')}</p>
          <div>
            <LinkButton
              href={tracking.reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="outline"
              tone="theme"
            >
              {t('feedback.tracking.reviewButton')}
            </LinkButton>
          </div>
        </div>
      )}
      {tracking.nps ? (
        <p role="status">{t('feedback.tracking.npsThanks')}</p>
      ) : (
        tracking.canAnswerNps && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="ui-heading">{t('feedback.tracking.npsQuestion')}</legend>
              <div className="flex flex-wrap gap-3">
                {values.map((value) => (
                  <label key={value} className="flex items-center gap-1">
                    <input
                      type="radio"
                      className="pui-radio"
                      name="nps"
                      value={value}
                      checked={score === value}
                      onChange={() => setScore(value)}
                      aria-label={t('feedback.tracking.npsScore', { score: value })}
                    />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-between gap-2">
                <span className="ui-caption">{t('feedback.tracking.npsLow')}</span>
                <span className="ui-caption">{t('feedback.tracking.npsHigh')}</span>
              </div>
            </fieldset>
            <TextAreaField
              label={t('feedback.tracking.npsComment')}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={300}
              rows={2}
            />
            {error && (
              <p role="alert" className="pui-alert pui-error">
                {error}
              </p>
            )}
            <div>
              <Button type="submit" disabled={busy || score === null}>
                {t('feedback.tracking.npsSubmit')}
              </Button>
            </div>
          </form>
        )
      )}
    </Card>
  );
}
