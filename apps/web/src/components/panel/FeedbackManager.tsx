'use client';

import { useCallback, useEffect, useState } from 'react';
import { FEEDBACK_REPORT_RANGE_DAYS, RATING_MAX, RATING_MIN, UpdateFeedbackSettingsSchema } from '@resget/shared';
import type { FeedbackCaseDTO, FeedbackOverviewDTO, FeedbackSettingsDTO } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextAreaField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * Feedback routing and NPS (docs/GERI_BILDIRIM.md): the review link and
 * thresholds, the period summary (rating spread, NPS and its comments) and
 * the low-rating cases to follow up.
 */
export function FeedbackManager({
  restaurantId,
  locale,
  isPro,
  canManageSettings,
  canManageCases,
  canSeeReports,
}: {
  restaurantId: string;
  locale: string;
  isPro: boolean;
  canManageSettings: boolean;
  canManageCases: boolean;
  canSeeReports: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/feedback`;
  const [settings, setSettings] = useState<{ reviewUrl: string; alertMaxScore: number; npsEnabled: boolean } | null>(
    null,
  );
  const [overview, setOverview] = useState<FeedbackOverviewDTO | null>(null);
  const [days, setDays] = useState<number>(90);
  const [cases, setCases] = useState<FeedbackCaseDTO[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const loadCases = useCallback(
    () => bffJson<FeedbackCaseDTO[]>(`${base}/cases${onlyOpen ? '?status=OPEN' : ''}`).then(setCases),
    [base, onlyOpen],
  );
  useEffect(() => {
    if (!isPro) return;
    bffJson<FeedbackSettingsDTO>(`${base}/settings`)
      .then((s) =>
        setSettings({ reviewUrl: s.reviewUrl ?? '', alertMaxScore: s.alertMaxScore, npsEnabled: s.npsEnabled }),
      )
      .catch(fail);
  }, [base, fail, isPro]);
  useEffect(() => {
    if (!isPro || !canSeeReports) return;
    bffJson<FeedbackOverviewDTO>(`${base}/overview?days=${days}`).then(setOverview).catch(fail);
  }, [base, days, fail, isPro, canSeeReports]);
  useEffect(() => {
    if (isPro) loadCases().catch(fail);
  }, [loadCases, fail, isPro]);

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const number = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);

  const saveSettings = async () => {
    if (!settings) return;
    setError(null);
    setNotice(null);
    const parsed = UpdateFeedbackSettingsSchema.safeParse({
      reviewUrl: settings.reviewUrl.trim() || null,
      alertMaxScore: settings.alertMaxScore,
      npsEnabled: settings.npsEnabled,
    });
    if (!parsed.success) {
      setError(t('feedback.settings.invalid'));
      return;
    }
    setBusy(true);
    try {
      await bffJson<FeedbackSettingsDTO>(`${base}/settings`, { method: 'PUT', body: JSON.stringify(parsed.data) });
      setNotice(t('feedback.settings.saved'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const updateCase = async (c: FeedbackCaseDTO, status: FeedbackCaseDTO['status']) => {
    setBusy(true);
    setError(null);
    try {
      const note = notes[c.id];
      await bffJson<FeedbackCaseDTO>(`${base}/cases/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(note !== undefined ? { note: note.trim() || null } : {}) }),
      });
      await loadCases();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const scores = Array.from({ length: RATING_MAX - 2 - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('feedback.title')}</h1>
        <p className="ui-text-muted">{t('feedback.intro')}</p>
      </header>
      {!isPro && <p className="pui-alert pui-warning">{t('feedback.proRequired')}</p>}
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="pui-alert pui-success">
          {notice}
        </p>
      )}

      {settings && (
        <Card title={t('feedback.settings.title')} aria-label={t('feedback.settings.title')}>
          <fieldset className="flex flex-col gap-3" disabled={!canManageSettings || busy}>
            <TextField
              label={t('feedback.settings.reviewUrl')}
              help={t('feedback.settings.reviewUrlHelp')}
              inputMode="url"
              value={settings.reviewUrl}
              onChange={(e) => setSettings({ ...settings, reviewUrl: e.target.value })}
            />
            <SelectField
              label={t('feedback.settings.alertMaxScore')}
              value={String(settings.alertMaxScore)}
              onChange={(e) => setSettings({ ...settings, alertMaxScore: Number(e.target.value) })}
            >
              {scores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectField>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="pui-checkbox"
                checked={settings.npsEnabled}
                onChange={(e) => setSettings({ ...settings, npsEnabled: e.target.checked })}
              />
              <span>{t('feedback.settings.npsEnabled')}</span>
            </label>
            {canManageSettings && (
              <div>
                <Button onClick={() => void saveSettings()}>{t('feedback.settings.save')}</Button>
              </div>
            )}
          </fieldset>
        </Card>
      )}

      {overview && (
        <Card
          title={t('feedback.overview.title')}
          aria-label={t('feedback.overview.title')}
          aside={
            <SelectField
              label={t('feedback.overview.range')}
              value={String(days)}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {FEEDBACK_REPORT_RANGE_DAYS.map((d) => (
                <option key={d} value={d}>
                  {t('feedback.overview.days', { days: d })}
                </option>
              ))}
            </SelectField>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1" data-feedback-ratings>
              {overview.ratings.average === null ? (
                <p className="ui-text-muted">{t('feedback.overview.noRatings')}</p>
              ) : (
                <>
                  <p className="ui-heading">
                    {t('feedback.overview.ratings', {
                      average: number(overview.ratings.average),
                      count: overview.ratings.count,
                    })}
                  </p>
                  {(['5', '4', '3', '2', '1'] as const).map((s) => (
                    <p key={s} className="ui-caption">
                      {t('feedback.overview.stars', { score: s, count: overview.ratings.distribution[s] })}
                    </p>
                  ))}
                </>
              )}
            </div>
            <div className="flex flex-col gap-1" data-feedback-nps>
              {overview.nps.score === null ? (
                <p className="ui-text-muted">{t('feedback.overview.noNps')}</p>
              ) : (
                <>
                  <p className="ui-heading">{t('feedback.overview.nps', { score: overview.nps.score })}</p>
                  <p className="ui-caption">
                    {t('feedback.overview.npsBreakdown', {
                      promoters: overview.nps.promoters,
                      passives: overview.nps.passives,
                      detractors: overview.nps.detractors,
                    })}
                  </p>
                </>
              )}
              <p className="ui-caption">{t('feedback.overview.openCases', { count: overview.openCases })}</p>
            </div>
          </div>
          {overview.nps.comments.length > 0 && (
            <div className="flex flex-col gap-1 ui-rule pt-3">
              <h3 className="ui-heading">{t('feedback.overview.npsComments')}</h3>
              <ul className="flex flex-col gap-1">
                {overview.nps.comments.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <Badge tone="muted">{c.score}</Badge>
                    <span>{c.comment}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {isPro && (
        <Card
          title={t('feedback.cases.title')}
          aria-label={t('feedback.cases.title')}
          aside={
            <div className="flex gap-2">
              <Button variant={onlyOpen ? 'solid' : 'outline'} tone="muted" onClick={() => setOnlyOpen(true)}>
                {t('feedback.cases.filterOpen')}
              </Button>
              <Button variant={onlyOpen ? 'outline' : 'solid'} tone="muted" onClick={() => setOnlyOpen(false)}>
                {t('feedback.cases.filterAll')}
              </Button>
            </div>
          }
        >
          {cases.length === 0 ? (
            <p className="ui-text-muted">{t('feedback.cases.empty')}</p>
          ) : (
            <ul className="flex flex-col ui-divide">
              {cases.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 py-3" data-feedback-case={c.shortCode}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="ui-heading">
                      {t('feedback.cases.line', { code: c.shortCode, score: c.score })}
                    </span>
                    <Badge tone={c.status === 'OPEN' ? 'error' : 'success'}>
                      {t(`feedback.cases.status.${c.status}`)}
                    </Badge>
                  </div>
                  <p className="ui-caption">{date(c.createdAt)}</p>
                  <p>{c.comment ?? t('feedback.cases.noComment')}</p>
                  {c.customer && (
                    <p className="ui-caption">
                      {t('feedback.cases.customer', { name: c.customer.fullName, phone: c.customer.phone })}
                    </p>
                  )}
                  {canManageCases ? (
                    <>
                      <TextAreaField
                        label={t('feedback.cases.note')}
                        rows={2}
                        maxLength={1000}
                        value={notes[c.id] ?? c.note ?? ''}
                        onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
                      />
                      <div className="flex flex-wrap gap-2">
                        {c.status === 'OPEN' ? (
                          <Button onClick={() => void updateCase(c, 'RESOLVED')} disabled={busy}>
                            {t('feedback.cases.resolve')}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            tone="muted"
                            onClick={() => void updateCase(c, 'OPEN')}
                            disabled={busy}
                          >
                            {t('feedback.cases.reopen')}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          tone="muted"
                          onClick={() => void updateCase(c, c.status)}
                          disabled={busy}
                        >
                          {t('feedback.cases.saveNote')}
                        </Button>
                      </div>
                    </>
                  ) : (
                    c.note && <p className="ui-caption">{c.note}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
