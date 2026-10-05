'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CAMPAIGN_ATTRIBUTION_DAYS,
  CAMPAIGN_BODY_MAX,
  CAMPAIGN_EMAIL_BODY_MAX,
  CAMPAIGN_SEND_TIME_MODES,
  CAMPAIGN_SUBJECT_MAX,
  CAMPAIGN_VARIANT_SHARE,
  formatMoney,
} from '@resget/shared';
import type {
  AudienceCountDTO,
  CampaignApprovalStatus,
  CampaignAudienceDTO,
  CampaignChannel,
  CampaignDTO,
  CampaignResultsDTO,
  CampaignSendTimeMode,
  CampaignDetailDTO,
  CampaignPageDTO,
  CampaignPreviewDTO,
  CampaignSegment,
  SavedSegmentDTO,
  SegmentListDTO,
} from '@resget/shared';
import { Badge, Button, Card, SelectField, TextAreaField, TextField } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const APPROVAL_TONE: Record<CampaignApprovalStatus, UiTone> = {
  NONE: 'muted',
  PENDING: 'warn',
  APPROVED: 'success',
  REJECTED: 'error',
};

const STATUS_TONE: Record<CampaignDTO['status'], UiTone> = {
  DRAFT: 'muted',
  SCHEDULED: 'warn',
  SENDING: 'warn',
  SENT: 'success',
  CANCELLED: 'muted',
};

/** PRO campaigns: draft, segment, preview with credits and send window, send or schedule, follow the counts. */
export function CampaignsManager({
  restaurantId,
  locale,
  canManage,
  segmentsV2 = false,
  campaignsV2 = false,
  emailChannel = false,
  approvals = false,
  canApprove = false,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
  /** The marketing_approvals module is on: a campaign is sent only after another person approves it (docs/ONAYLAR.md). */
  approvals?: boolean;
  /** The viewer may approve or reject requests (campaigns.approve). */
  canApprove?: boolean;
  /** The segments_v2 module is on: a saved rule-based segment can be the audience (docs/SEGMENTLER.md). */
  segmentsV2?: boolean;
  /** The campaigns_v2 module is on: A/B test, best send hour, conversions (docs/KAMPANYALAR.md). */
  campaignsV2?: boolean;
  /** The email_channel module is on; with campaigns v2 a campaign can go by email. */
  emailChannel?: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/campaigns`;
  const [page, setPage] = useState<CampaignPageDTO | null>(null);
  const [audience, setAudience] = useState<CampaignAudienceDTO | null>(null);
  const [name, setName] = useState('');
  const channels: CampaignChannel[] = ['SMS', 'WHATSAPP', ...(campaignsV2 && emailChannel ? (['EMAIL'] as const) : [])];
  const [channel, setChannel] = useState<CampaignChannel>('SMS');
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [abTest, setAbTest] = useState(false);
  const [variantBody, setVariantBody] = useState('');
  const [variantSubject, setVariantSubject] = useState('');
  const [variantShare, setVariantShare] = useState(String(CAMPAIGN_VARIANT_SHARE.default));
  const [sendTimeMode, setSendTimeMode] = useState<CampaignSendTimeMode>('FIXED');
  const [attributionDays, setAttributionDays] = useState(String(CAMPAIGN_ATTRIBUTION_DAYS.default));
  const [results, setResults] = useState<CampaignResultsDTO | null>(null);
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
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});

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
          ...(channel === 'EMAIL' ? { subject: subject.trim() } : {}),
          ...(campaignsV2 && abTest
            ? {
                variant: {
                  body: variantBody.trim(),
                  ...(channel === 'EMAIL' && variantSubject.trim() ? { subject: variantSubject.trim() } : {}),
                  sharePct: Number(variantShare),
                },
              }
            : {}),
          ...(campaignsV2 ? { sendTimeMode, attributionDays: Number(attributionDays) } : {}),
          segment: ruleSegment ? {} : segment(),
          ...(ruleSegment ? { segmentId: ruleSegment } : {}),
          ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
        }),
      });
      setNotice(scheduledAt ? t('campaigns.queued') : t('campaigns.created'));
      setName('');
      setBody('');
      setSubject('');
      setAbTest(false);
      setVariantBody('');
      setVariantSubject('');
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
  const requestApproval = (id: string) =>
    act(async () => {
      await bffJson<CampaignDTO>(`${base}/${id}/approval/request`, { method: 'POST', body: '{}' });
      setNotice(t('approvals.requested'));
    });
  const approve = (id: string) =>
    act(async () => {
      await bffJson<CampaignDTO>(`${base}/${id}/approval/approve`, { method: 'POST', body: '{}' });
      setNotice(t('approvals.approved'));
    });
  const reject = (id: string) =>
    act(async () => {
      await bffJson<CampaignDTO>(`${base}/${id}/approval/reject`, {
        method: 'POST',
        body: JSON.stringify({ note: (rejectNotes[id] ?? '').trim() }),
      });
      setRejectNotes({ ...rejectNotes, [id]: '' });
      setNotice(t('approvals.rejected'));
    });
  /** Under approvals only an approved campaign may be sent. */
  const sendable = (c: CampaignDTO) => !approvals || c.approval.status === 'APPROVED';
  const cancel = (id: string) =>
    act(async () => {
      await bffJson<CampaignDTO>(`${base}/${id}/cancel`, { method: 'POST', body: '{}' });
      setNotice(t('campaigns.cancelled'));
    });
  const showResults = (id: string) =>
    act(async () => {
      setResults(await bffJson<CampaignResultsDTO>(`${base}/${id}/results`));
    });
  const bodyMax = channel === 'EMAIL' ? CAMPAIGN_EMAIL_BODY_MAX : CAMPAIGN_BODY_MAX;
  const percent = (bps: number) =>
    new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(bps / 10_000);
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
              onChange={(e) => setChannel(e.target.value as CampaignChannel)}
            >
              {channels.map((c) => (
                <option key={c} value={c}>
                  {t(`campaigns.channel.${c}`)}
                </option>
              ))}
            </SelectField>
            <TextAreaField
              className="md:col-span-2"
              label={t('campaigns.body')}
              help={t('campaigns.bodyHelp', { count: body.length, max: bodyMax })}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={bodyMax}
              rows={channel === 'EMAIL' ? 8 : 4}
            />
            {channel === 'EMAIL' && (
              <>
                <TextField
                  className="md:col-span-2"
                  label={t('campaigns.v2.subject')}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={CAMPAIGN_SUBJECT_MAX}
                />
                <p className="ui-caption md:col-span-2">{t('campaigns.v2.emailHelp')}</p>
              </>
            )}
          </div>
          {campaignsV2 && (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 md:col-span-2">
                <input
                  type="checkbox"
                  className="pui-checkbox"
                  checked={abTest}
                  onChange={(e) => setAbTest(e.target.checked)}
                />
                <span>{t('campaigns.v2.abTest')}</span>
              </label>
              {abTest && (
                <>
                  <TextAreaField
                    className="md:col-span-2"
                    label={t('campaigns.v2.variantBody')}
                    value={variantBody}
                    onChange={(e) => setVariantBody(e.target.value)}
                    maxLength={bodyMax}
                    rows={channel === 'EMAIL' ? 8 : 4}
                  />
                  {channel === 'EMAIL' && (
                    <TextField
                      label={t('campaigns.v2.variantSubject')}
                      value={variantSubject}
                      onChange={(e) => setVariantSubject(e.target.value)}
                      maxLength={CAMPAIGN_SUBJECT_MAX}
                    />
                  )}
                  <TextField
                    label={t('campaigns.v2.variantShare')}
                    type="number"
                    min={CAMPAIGN_VARIANT_SHARE.min}
                    max={CAMPAIGN_VARIANT_SHARE.max}
                    value={variantShare}
                    onChange={(e) => setVariantShare(e.target.value)}
                  />
                </>
              )}
              <SelectField
                label={t('campaigns.v2.sendTime')}
                help={t('campaigns.v2.sendTime.help')}
                value={sendTimeMode}
                onChange={(e) => setSendTimeMode(e.target.value as CampaignSendTimeMode)}
              >
                {CAMPAIGN_SEND_TIME_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`campaigns.v2.sendTime.${mode}`)}
                  </option>
                ))}
              </SelectField>
              <TextField
                label={t('campaigns.v2.attributionDays')}
                help={t('campaigns.v2.attributionHelp')}
                type="number"
                min={CAMPAIGN_ATTRIBUTION_DAYS.min}
                max={CAMPAIGN_ATTRIBUTION_DAYS.max}
                value={attributionDays}
                onChange={(e) => setAttributionDays(e.target.value)}
              />
            </div>
          )}
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
            {approvals ? (
              <p className="ui-caption">{t('approvals.draftFirst')}</p>
            ) : (
              <TextField
                label={t('campaigns.scheduledAt')}
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            )}
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
          {preview.data.renderedVariantExample && (
            <>
              <p className="ui-caption">{t('campaigns.v2.variantPreview')}</p>
              <blockquote className="pui-card pui-card-content">{preview.data.renderedVariantExample}</blockquote>
            </>
          )}
          {preview.data.guards.approvalRequired && (
            <p className="ui-caption" data-preview-approval={preview.data.guards.approval.status}>
              {t(`approvals.previewStatus.${preview.data.guards.approval.status}`)}
            </p>
          )}
          {preview.data.guards.limit && (
            <p className="ui-caption" data-preview-limit>
              {t('approvals.previewLimit', {
                perCampaign: preview.data.guards.limit.maxPerCampaign ?? t('approvals.noLimit'),
                perDay: preview.data.guards.limit.maxPerDay ?? t('approvals.noLimit'),
                used: preview.data.guards.limit.usedLast24h,
              })}
            </p>
          )}
          {preview.data.guards.limitBlock && (
            <p className="pui-alert pui-error" data-preview-block={preview.data.guards.limitBlock}>
              {t(`approvals.block.${preview.data.guards.limitBlock}`)}
            </p>
          )}
          {canManage && (
            <div>
              <Button
                onClick={() => sendNow(preview.id)}
                disabled={
                  busy ||
                  preview.data.audienceCount === 0 ||
                  preview.data.guards.limitBlock !== null ||
                  (preview.data.guards.approvalRequired && preview.data.guards.approval.status !== 'APPROVED')
                }
              >
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
                  <span className="flex flex-wrap gap-2">
                    {approvals && c.status === 'DRAFT' && (
                      <Badge tone={APPROVAL_TONE[c.approval.status]} data-approval={c.approval.status}>
                        {t(`approvals.status.${c.approval.status}`)}
                      </Badge>
                    )}
                    <Badge tone={STATUS_TONE[c.status]}>{t(`campaigns.status.${c.status}`)}</Badge>
                  </span>
                </div>
                {approvals && c.approval.requestedBy && c.approval.requestedAt && (
                  <p className="ui-caption">
                    {t('approvals.requestedBy', { name: c.approval.requestedBy, date: when(c.approval.requestedAt) })}
                    {c.approval.decidedBy &&
                      c.approval.decidedAt &&
                      `. ${t('approvals.decidedBy', { name: c.approval.decidedBy, date: when(c.approval.decidedAt) })}`}
                  </p>
                )}
                {approvals && c.approval.status === 'REJECTED' && c.approval.note && (
                  <p className="ui-caption">{t('approvals.rejectNote', { note: c.approval.note })}</p>
                )}
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
                  {campaignsV2 && (c.status === 'SENDING' || c.status === 'SENT') && (
                    <Button variant="outline" tone="muted" onClick={() => showResults(c.id)} disabled={busy}>
                      {t('campaigns.v2.results')}
                    </Button>
                  )}
                  {(c.status === 'DRAFT' || c.status === 'SCHEDULED') && (
                    <Button variant="outline" tone="muted" onClick={() => showPreview(c.id)} disabled={busy}>
                      {t('campaigns.preview')}
                    </Button>
                  )}
                  {canManage &&
                    approvals &&
                    c.status === 'DRAFT' &&
                    (c.approval.status === 'NONE' || c.approval.status === 'REJECTED') && (
                      <Button variant="outline" tone="theme" onClick={() => requestApproval(c.id)} disabled={busy}>
                        {t('approvals.request')}
                      </Button>
                    )}
                  {canApprove && approvals && c.status === 'DRAFT' && c.approval.status === 'PENDING' && (
                    <Button onClick={() => approve(c.id)} disabled={busy}>
                      {t('approvals.approve')}
                    </Button>
                  )}
                  {canManage && c.status === 'DRAFT' && sendable(c) && (
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
                {canApprove && approvals && c.status === 'DRAFT' && c.approval.status === 'PENDING' && (
                  <div className="flex flex-col gap-2 md:flex-row md:items-end">
                    <TextField
                      label={t('approvals.rejectReason')}
                      maxLength={500}
                      value={rejectNotes[c.id] ?? ''}
                      onChange={(e) => setRejectNotes({ ...rejectNotes, [c.id]: e.target.value })}
                    />
                    <Button
                      variant="outline"
                      tone="error"
                      onClick={() => reject(c.id)}
                      disabled={busy || (rejectNotes[c.id] ?? '').trim().length < 2}
                    >
                      {t('approvals.reject')}
                    </Button>
                  </div>
                )}
                {results?.campaignId === c.id && (
                  <section className="flex flex-col gap-2" aria-label={t('campaigns.v2.results.title')}>
                    <p className="ui-caption">{t('campaigns.v2.results.window', { days: results.attributionDays })}</p>
                    <ul className="grid gap-3 md:grid-cols-2">
                      {results.variants.map((v) => (
                        <li key={v.variant} className="flex flex-col gap-1" data-variant={v.variant}>
                          <span className="ui-heading">
                            {t('campaigns.v2.results.variant', { variant: v.variant })}
                          </span>
                          <span className="ui-caption">{t('campaigns.v2.results.sent', { count: v.sent })}</span>
                          <span className="ui-caption">
                            {t('campaigns.v2.results.skipped', { count: v.skipped, failed: v.failed })}
                          </span>
                          <span>
                            {t('campaigns.v2.results.conversions', {
                              count: v.conversions,
                              rate: percent(v.conversionRateBps),
                            })}
                          </span>
                          <span>
                            {t('campaigns.v2.results.revenue', {
                              amount: formatMoney({ amountMinor: v.revenueMinor, currency: results.currency }, locale),
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {results.variants.length > 1 && (
                      <p role="status">
                        {results.leader
                          ? t('campaigns.v2.results.leader', { variant: results.leader })
                          : t('campaigns.v2.results.noLeader')}
                      </p>
                    )}
                  </section>
                )}
                {detail?.id === c.id && (
                  <ul className="flex flex-col gap-1">
                    {detail.recipients.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2">
                        <span className="ui-caption">{r.fullName}</span>
                        <span className="ui-caption">
                          {t(`campaigns.recipient.status.${r.status}`)}
                          {r.errorCode ? ` (${r.errorCode})` : ''}
                          {campaignsV2 &&
                            c.variant &&
                            `. ${t('campaigns.v2.recipient.variant', { variant: r.variant })}`}
                          {campaignsV2 &&
                            r.dueAt &&
                            r.status === 'PENDING' &&
                            `. ${t('campaigns.v2.recipient.due', { date: when(r.dueAt) })}`}
                          {r.convertedAt && `. ${t('campaigns.v2.recipient.converted')}`}
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
