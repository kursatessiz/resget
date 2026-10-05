'use client';

import { useState } from 'react';
import { AI_TONES } from '@resget/shared';
import type { AiCampaignChannel, AiDraftDTO, AiDraftResultDTO, AiTone } from '@resget/shared';
import { Button, SelectField, TextAreaField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * AI studio helpers (docs/YAPAY_ZEKA.md). They only draft: a chosen draft
 * fills the form the user is already in, and nothing is saved or sent until
 * they do it themselves. Personal data typed into the brief is removed
 * before it reaches the model; the panel says how many items were removed.
 */
function useDrafts(restaurantId: string, locale: string, path: string) {
  const t = useT(locale);
  const [result, setResult] = useState<AiDraftResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await bffJson<AiDraftResultDTO>(`restaurants/${restaurantId}/ai/${path}`, {
          method: 'POST',
          body: JSON.stringify({ ...body, locale }),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };
  return { t, result, error, busy, run };
}

function DraftList({
  locale,
  result,
  error,
  onUse,
}: {
  locale: string;
  result: AiDraftResultDTO | null;
  error: string | null;
  onUse: (draft: AiDraftDTO) => void;
}) {
  const t = useT(locale);
  const number = (n: number) => new Intl.NumberFormat(locale).format(n);
  return (
    <>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {result && (
        <div className="flex flex-col gap-2" data-ai-drafts>
          {result.redactions > 0 && (
            <p className="ui-caption" data-ai-redactions>
              {t('ai.redacted', { count: result.redactions })}
            </p>
          )}
          <ul className="flex flex-col ui-divide">
            {result.drafts.map((draft, i) => (
              <li key={i} className="flex flex-col gap-1 py-2" data-ai-draft={i}>
                {draft.subject && <span className="ui-heading">{draft.subject}</span>}
                <span>{draft.body}</span>
                <span className="ui-caption">{t('ai.length', { count: draft.body.length })}</span>
                <div>
                  <Button variant="outline" tone="theme" onClick={() => onUse(draft)}>
                    {t('ai.use')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="ui-caption" data-ai-budget>
            {t('ai.budget', {
              remaining: number(result.budget.remaining),
              limit: number(result.budget.monthlyTokenLimit),
            })}
          </p>
        </div>
      )}
    </>
  );
}

function ToneField({
  t,
  value,
  onChange,
}: {
  t: ReturnType<typeof useT>;
  value: AiTone;
  onChange: (v: AiTone) => void;
}) {
  return (
    <SelectField label={t('ai.tone')} value={value} onChange={(e) => onChange(e.target.value as AiTone)}>
      {AI_TONES.map((tone) => (
        <option key={tone} value={tone}>
          {t(`ai.tone.${tone}`)}
        </option>
      ))}
    </SelectField>
  );
}

/** Campaign message drafts for the channel the form is set to. */
export function AiCampaignAssistant({
  restaurantId,
  locale,
  channel,
  onUse,
}: {
  restaurantId: string;
  locale: string;
  channel: AiCampaignChannel;
  onUse: (draft: AiDraftDTO) => void;
}) {
  const { t, result, error, busy, run } = useDrafts(restaurantId, locale, 'campaign-drafts');
  const [brief, setBrief] = useState('');
  const [tone, setTone] = useState<AiTone>('FRIENDLY');
  return (
    <section className="flex flex-col gap-2 ui-rule pt-3" aria-label={t('ai.campaign.title')}>
      <h3 className="ui-heading">{t('ai.campaign.title')}</h3>
      <p className="ui-caption">{t('ai.notice')}</p>
      <TextAreaField
        label={t('ai.campaign.brief')}
        help={t('ai.briefHelp')}
        rows={2}
        maxLength={500}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
      />
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <ToneField t={t} value={tone} onChange={setTone} />
        <Button
          variant="outline"
          tone="muted"
          disabled={busy || brief.trim().length < 5}
          onClick={() => void run({ brief: brief.trim(), channel, tone, variants: 2 })}
        >
          {busy ? t('ai.working') : t('ai.generate')}
        </Button>
      </div>
      <DraftList locale={locale} result={result} error={error} onUse={onUse} />
    </section>
  );
}

/** Menu item description drafts from the item's name and the restaurant's notes. */
export function AiMenuAssistant({
  restaurantId,
  locale,
  itemName,
  onUse,
}: {
  restaurantId: string;
  locale: string;
  itemName: string;
  onUse: (description: string) => void;
}) {
  const { t, result, error, busy, run } = useDrafts(restaurantId, locale, 'menu-descriptions');
  const [notes, setNotes] = useState('');
  const [tone, setTone] = useState<AiTone>('FRIENDLY');
  return (
    <section className="flex flex-col gap-2 md:col-span-2" aria-label={t('ai.menu.title')}>
      <h3 className="ui-heading">{t('ai.menu.title')}</h3>
      <p className="ui-caption">{t('ai.notice')}</p>
      <TextAreaField
        label={t('ai.menu.notes')}
        help={t('ai.menu.notesHelp')}
        rows={2}
        maxLength={300}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <ToneField t={t} value={tone} onChange={setTone} />
        <Button
          variant="outline"
          tone="muted"
          disabled={busy || itemName.trim().length < 1}
          onClick={() => void run({ itemName: itemName.trim(), notes: notes.trim(), tone })}
        >
          {busy ? t('ai.working') : t('ai.generate')}
        </Button>
      </div>
      <DraftList locale={locale} result={result} error={error} onUse={(draft) => onUse(draft.body)} />
    </section>
  );
}
