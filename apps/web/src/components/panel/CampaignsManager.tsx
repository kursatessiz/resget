'use client';

import { useCallback, useEffect, useState } from 'react';
import { CAMPAIGN_BODY_MAX } from '@resget/shared';
import type {
  AudienceCountDTO,
  CampaignAudienceDTO,
  CampaignDTO,
  CampaignDetailDTO,
  CampaignPageDTO,
  CampaignPreviewDTO,
  CampaignSegment,
  NotificationChannel,
  SavedSegmentDTO,
  SegmentListDTO,
} from '@resget/shared';
import { Badge, Button, Card, SelectField, TextAreaField, TextField } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const STATUS_TONE: Record<CampaignDTO['status'], UiTone> = {
  DRAFT: 'muted',
  SCHEDULED: 'warn',
  SENDING: 'warn',
  SENT: 'success',
  CANCELLED: 'muted',
};
const CHANNELS: NotificationChannel[] = ['SMS', 'WHATSAPP'];

/** PRO campaigns: draft, segment, preview with credits and send window, send or schedule, follow the counts. */
export function CampaignsManager({
  restaurantId,
  locale,
  canManage,
  segmentsV2 = false,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
  /** The segments_v2 module is on: a saved rule-based segment can be the audience (docs/SEGMENTLER.md). */
  segmentsV2?: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/campaigns`;
  const [page, setPage] = useState<CampaignPageDTO | null>(null);
  const [audience, setAudience] = useState<CampaignAudienceDTO | null>(null);
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<NotificationChannel>('SMS');
  const [body, setBody] = useState('');
  const [minOrders, setMinOrders] = useState('');
  const [lastWithin, setLastWithin] = useState('');
  const [inactiveFor, setInactiveFor] = useState('');
  const [tags, setTags] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [segments, setSegments] = useState<SavedSegmentDTO[]>([]);
  const [pickedSegment, setPickedSegment] = useState('');
  const [segmentName, setSegmentName] = useState('');
  const [ruleSegments, setRuleSegments] = useState<SegmentListDTO['items']>([]);
  const [ruleSegment, setRuleSegment] = useState('');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ id: string; data: CampaignPreviewDTO } | null>(null);
  const [detail, setDetail] = useState<CampaignDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  const load = useCallback(async () => {
    const [list, who, saved] = await Promise.all([
      bffJson<CampaignPageDTO>(`${base}?page=1&pageSize=50`),
      bffJson<CampaignAudienceDTO>(`${base}/audience`),
      bffJson<SavedSegmentDTO[]>(`${base}/segments`),
    ]);
    setPage(list);
    setAudience(who);
    setSegments(saved);
    if (segmentsV2) setRuleSegments((await bffJson<SegmentListDTO>(`restaurants/${restaurantId}/segments`)).items);
  }, [base, segmentsV2, restaurantId]);

  useEffect(() => {
    load().catch(fail);
  }, [load, fail]);

  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await run();
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const segment = () => ({
    ...(minOrders.trim() ? { minOrders: Number(minOrders) } : {}),
    ...(lastWithin.trim() ? { lastOrderWithinDays: Number(lastWithin) } : {}),
    ...(inactiveFor.trim() ? { inactiveForDays: Number(inactiveFor) } : {}),
    ...(tags.trim()
      ? {
          tags: tags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {}),
  });

  /** Loads a saved segment into the filter fields; an empty choice clears them. */
  const applySegment = (id: string) => {
    setPickedSegment(id);
    setEstimate(null);
    const chosen: CampaignSegment = segments.find((s) => s.id === id)?.segment ?? {};
    setMinOrders(chosen.minOrders !== undefined ? String(chosen.minOrders) : '');
    setLastWithin(chosen.lastOrderWithinDays !== undefined ? String(chosen.lastOrderWithinDays) : '');
    setInactiveFor(chosen.inactiveForDays !== undefined ? String(chosen.inactiveForDays) : '');
    setTags(chosen.tags ? chosen.tags.join(', ') : '');
  };
  const countNow = () =>
    act(async () => {
      const result = await bffJson<AudienceCountDTO>(`${base}/audience/count`, {
        method: 'POST',
        body: JSON.stringify({ segment: segment() }),
      });
      setEstimate(result.audienceCount);
    });
  const saveSegment = () =>
    act(async () => {
      const saved = await bffJson<SavedSegmentDTO>(`${base}/segments`, {
        method: 'POST',
        body: JSON.stringify({ name: segmentName.trim(), segment: segment() }),
      });
      setSegmentName('');
      setPickedSegment(saved.id);
      setNotice(t('campaigns.segments.saved'));
    });
  const deleteSegment = (id: string) =>
    act(async () => {
      await bffJson<void>(`${base}/segments/${id}`, { method: 'DELETE' });
      if (pickedSegment === id) setPickedSegment('');
      setNotice(t('campaigns.segments.deleted'));
    });

  const create = () =>
    act(async () => {
      const created = await bffJson<CampaignDTO>(base, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          channel,
          body: body.trim(),
          segment: ruleSegment ? {} : segment(),
          ...(ruleSegment ? { segmentId: ruleSegment } : {}),
          ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
        }),
      });
      setNotice(scheduledAt ? t('campaigns.queued') : t('campaigns.created'));
      setName('');
      setBody('');
      setScheduledAt('');
      setRuleSegment('');
      const data = await bffJson<CampaignPreviewDTO>(`${base}/${created.id}/preview`, { method: 'POST', body: '{}' });
      setPreview({ id: created.id, data });
    });

  const showPreview = (id: string) =>
    act(async () => {
      setPreview({
        id,
        data: await bffJson<CampaignPreviewDTO>(`${base}/${id}/preview`, { method: 'POST', body: '{}' }),
      });
    });
  const sendNow = (id: string) =>
    act(async () => {
      await bffJson<CampaignDTO>(`${base}/${id}/send`, { method: 'POST', body: '{}' });
      setNotice(t('campaigns.queued'));
      setPreview(null);
    });
  const cancel = (id: string) =>
    act(async () => {
      await bffJson<CampaignDTO>(`${base}/${id}/cancel`, { method: 'POST', body: '{}' });
      setNotice(t('campaigns.cancelled'));
    });
  const open = (id: string) =>
    act(async () => {
      setDetail(await bffJson<CampaignDetailDTO>(`${base}/${id}`));
    });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('campaigns.title')}</h1>
        <p className="ui-text-muted">{t('campaigns.intro')}</p>
        {audience && (
          <p className="ui-caption">{t('campaigns.audience', { count: audience.optedIn, total: audience.total })}</p>
        )}
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {notice && <p className="pui-alert pui-success">{notice}</p>}

      {canManage && (
        <Card title={t('campaigns.new')}>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label={t('campaigns.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
            <SelectField
              label={t('campaigns.channel')}
              value={channel}
              onChange={(e) => setChannel(e.target.value as NotificationChannel)}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`campaigns.channel.${c}`)}
                </option>
              ))}
            </SelectField>
            <TextAreaField
              className="md:col-span-2"
              label={t('campaigns.body')}
              help={t('campaigns.bodyHelp', { count: body.length, max: CAMPAIGN_BODY_MAX })}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={CAMPAIGN_BODY_MAX}
              rows={4}
            />
          </div>
          {segmentsV2 && (
            <div className="flex flex-col gap-1">
              <SelectField
                label={t('segments.campaign.pick')}
                value={ruleSegment}
                onChange={(e) => setRuleSegment(e.target.value)}
              >
                <option value="">{t('segments.campaign.none')}</option>
                {ruleSegments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({t(`segments.kind.${s.kind}`)}, {t('segments.count', { count: s.count })})
                  </option>
                ))}
              </SelectField>
              <p className="ui-caption">{t('segments.campaign.help')}</p>
            </div>
          )}
          {ruleSegment === '' && (
            <fieldset className="grid gap-3 md:grid-cols-4">
              <legend className="ui-heading">{t('campaigns.segment.title')}</legend>
              <SelectField
                className="md:col-span-4"
                label={t('campaigns.segments.pick')}
                value={pickedSegment}
                onChange={(e) => applySegment(e.target.value)}
              >
                <option value="">{t('campaigns.segments.none')}</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({t('campaigns.segments.count', { count: s.audienceCount })})
                  </option>
                ))}
              </SelectField>
              <TextField
                label={t('campaigns.segment.minOrders')}
                value={minOrders}
                onChange={(e) => setMinOrders(e.target.value)}
                inputMode="numeric"
              />
              <TextField
                label={t('campaigns.segment.lastOrderWithinDays')}
                value={lastWithin}
                onChange={(e) => setLastWithin(e.target.value)}
                inputMode="numeric"
              />
              <TextField
                label={t('campaigns.segment.inactiveForDays')}
                value={inactiveFor}
                onChange={(e) => setInactiveFor(e.target.value)}
                inputMode="numeric"
              />
              <TextField label={t('campaigns.segment.tags')} value={tags} onChange={(e) => setTags(e.target.value)} />
              <div className="flex flex-col gap-3 md:col-span-4 md:flex-row md:items-end">
                <TextField
                  label={t('campaigns.segments.name')}
                  value={segmentName}
                  onChange={(e) => setSegmentName(e.target.value)}
                  maxLength={60}
                />
                <Button
                  variant="outline"
                  tone="muted"
                  onClick={saveSegment}
                  disabled={busy || segmentName.trim().length < 2}
                >
                  {t('campaigns.segments.save')}
                </Button>
                <Button variant="outline" tone="muted" onClick={countNow} disabled={busy}>
                  {t('campaigns.segments.countNow')}
                </Button>
              </div>
              {estimate !== null && (
                <p role="status" className="ui-caption md:col-span-4">
                  {t('campaigns.segments.estimate', { count: estimate })}
                </p>
              )}
            </fieldset>
          )}
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <TextField
              label={t('campaigns.scheduledAt')}
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            <Button onClick={create} disabled={busy || name.trim().length < 2 || body.trim().length < 5}>
              {scheduledAt ? t('campaigns.schedule') : t('campaigns.save')}
            </Button>
          </div>
          <p className="ui-caption">{t('campaigns.rules')}</p>
        </Card>
      )}

      {canManage && segments.length > 0 && (
        <Card title={t('campaigns.segments.title')} aria-label={t('campaigns.segments.title')}>
          <ul className="flex flex-col gap-2">
            {segments.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2" aria-label={s.name}>
                <span>
                  {s.name}{' '}
                  <span className="ui-caption">{t('campaigns.segments.count', { count: s.audienceCount })}</span>
                </span>
                <Button variant="outline" tone="muted" onClick={() => deleteSegment(s.id)} disabled={busy}>
                  {t('campaigns.segments.delete')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {preview && (
        <Card title={t('campaigns.preview.title')} aria-label={t('campaigns.preview.title')}>
          <p>{t('campaigns.preview.audience', { count: preview.data.audienceCount })}</p>
          <p className={preview.data.enoughCredits ? undefined : 'ui-text-muted'}>
            {t('campaigns.preview.credits', {
              needed: preview.data.creditsNeeded,
              balance: preview.data.walletBalance,
            })}
          </p>
          {!preview.data.enoughCredits && <p className="ui-caption">{t('campaigns.preview.notEnough')}</p>}
          <p className="ui-caption">
            {preview.data.withinSendWindowNow
              ? t('campaigns.preview.windowNow')
              : t('campaigns.preview.windowLater', { date: when(preview.data.nextSendWindowStart) })}
          </p>
          <p className="ui-caption">{t('campaigns.preview.example')}</p>
          <blockquote className="pui-card pui-card-content">{preview.data.renderedExample}</blockquote>
          {canManage && (
            <div>
              <Button onClick={() => sendNow(preview.id)} disabled={busy || preview.data.audienceCount === 0}>
                {t('campaigns.sendNow')}
              </Button>
            </div>
          )}
        </Card>
      )}

      <Card title={t('campaigns.list.title')}>
        {page && page.items.length === 0 && <p className="ui-text-muted">{t('campaigns.list.empty')}</p>}
        {page && page.items.length > 0 && (
          <ul className="flex flex-col gap-3">
            {page.items.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 ui-rule pt-3" aria-label={c.name}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="ui-heading">
                    {c.name} ({t(`campaigns.channel.${c.channel}`)})
                  </span>
                  <Badge tone={STATUS_TONE[c.status]}>{t(`campaigns.status.${c.status}`)}</Badge>
                </div>
                <p className="ui-caption">{c.body}</p>
                {c.segmentId && (
                  <p className="ui-caption">
                    {t('segments.campaign.target', {
                      name: ruleSegments.find((s) => s.id === c.segmentId)?.name ?? t('segments.campaign.unknown'),
                    })}
                  </p>
                )}
                <p className="ui-caption">
                  {t('campaigns.counts', {
                    sent: c.sentCount,
                    failed: c.failedCount,
                    skipped: c.skippedCount,
                    audience: c.audienceCount,
                  })}
                  {c.scheduledAt &&
                    c.status === 'SCHEDULED' &&
                    `. ${t('campaigns.scheduledFor', { date: when(c.scheduledAt) })}`}
                  {c.lastError && `. ${t('campaigns.lastError', { code: c.lastError })}`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" tone="muted" onClick={() => open(c.id)} disabled={busy}>
                    {t('campaigns.recipients')}
                  </Button>
                  {(c.status === 'DRAFT' || c.status === 'SCHEDULED') && (
                    <Button variant="outline" tone="muted" onClick={() => showPreview(c.id)} disabled={busy}>
                      {t('campaigns.preview')}
                    </Button>
                  )}
                  {canManage && c.status === 'DRAFT' && (
                    <Button onClick={() => sendNow(c.id)} disabled={busy}>
                      {t('campaigns.sendNow')}
                    </Button>
                  )}
                  {canManage && (c.status === 'DRAFT' || c.status === 'SCHEDULED' || c.status === 'SENDING') && (
                    <Button variant="outline" tone="error" onClick={() => cancel(c.id)} disabled={busy}>
                      {t('campaigns.cancel')}
                    </Button>
                  )}
                </div>
                {detail?.id === c.id && (
                  <ul className="flex flex-col gap-1">
                    {detail.recipients.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2">
                        <span className="ui-caption">{r.fullName}</span>
                        <span className="ui-caption">
                          {t(`campaigns.recipient.status.${r.status}`)}
                          {r.errorCode ? ` (${r.errorCode})` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
