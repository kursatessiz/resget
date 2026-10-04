'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CAMPAIGN_ATTRIBUTION_DAYS,
  CAMPAIGN_BODY_MAX,
  CAMPAIGN_EMAIL_BODY_MAX,
  CAMPAIGN_SUBJECT_MAX,
  JOURNEY_COOLDOWN_DAYS,
  JOURNEY_DEFAULT_DELAY_HOURS,
  JOURNEY_DELAY_HOURS,
  JOURNEY_INACTIVE_DAYS,
  JOURNEY_TRIGGERS,
  formatMoney,
} from '@resget/shared';
import type { CampaignChannel, JourneyDTO, JourneyListDTO, JourneyTrigger, SegmentListDTO } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextAreaField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** The placeholders shown literally in help and suggested texts. */
const TOKENS = { name: '{name}', restaurant: '{restaurant}', link: '{link}' };

/**
 * Automated flows (docs/AKISLAR.md): write a flow for a trigger, save it
 * paused, switch it on or off, edit, delete, and follow its counts.
 */
export function JourneysManager({
  restaurantId,
  locale,
  canManage,
  emailChannel,
  segmentsV2,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
  /** The email module is on: flows can go by email. */
  emailChannel: boolean;
  /** Segments v2 is on: a saved segment can narrow a flow. */
  segmentsV2: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/journeys`;
  const channels: CampaignChannel[] = ['SMS', 'WHATSAPP', ...(emailChannel ? (['EMAIL'] as const) : [])];
  const [list, setList] = useState<JourneyListDTO | null>(null);
  const [segments, setSegments] = useState<SegmentListDTO['items']>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<JourneyTrigger>('ORDER_COMPLETED');
  const [channel, setChannel] = useState<CampaignChannel>('SMS');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [delayHours, setDelayHours] = useState(String(JOURNEY_DEFAULT_DELAY_HOURS.ORDER_COMPLETED));
  const [inactiveDays, setInactiveDays] = useState(String(JOURNEY_INACTIVE_DAYS.default));
  const [cooldownDays, setCooldownDays] = useState(String(JOURNEY_COOLDOWN_DAYS.default));
  const [attributionDays, setAttributionDays] = useState(String(CAMPAIGN_ATTRIBUTION_DAYS.default));
  const [segmentId, setSegmentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  const load = useCallback(async () => {
    setList(await bffJson<JourneyListDTO>(base));
  }, [base]);

  useEffect(() => {
    load().catch(fail);
  }, [load, fail]);

  useEffect(() => {
    if (!segmentsV2) return;
    bffJson<SegmentListDTO>(`restaurants/${restaurantId}/segments`)
      .then((result) => setSegments(result.items))
      .catch(() => setSegments([]));
  }, [segmentsV2, restaurantId]);

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

  const reset = () => {
    setEditing(null);
    setName('');
    setTrigger('ORDER_COMPLETED');
    setChannel('SMS');
    setSubject('');
    setBody('');
    setDelayHours(String(JOURNEY_DEFAULT_DELAY_HOURS.ORDER_COMPLETED));
    setInactiveDays(String(JOURNEY_INACTIVE_DAYS.default));
    setCooldownDays(String(JOURNEY_COOLDOWN_DAYS.default));
    setAttributionDays(String(CAMPAIGN_ATTRIBUTION_DAYS.default));
    setSegmentId('');
  };

  const pickTrigger = (next: JourneyTrigger) => {
    setTrigger(next);
    setDelayHours(String(JOURNEY_DEFAULT_DELAY_HOURS[next]));
  };

  const payload = () => ({
    name: name.trim(),
    channel,
    subject: channel === 'EMAIL' ? subject.trim() : null,
    body: body.trim(),
    delayHours: Number(delayHours),
    ...(trigger === 'WIN_BACK' ? { inactiveDays: Number(inactiveDays) } : {}),
    cooldownDays: Number(cooldownDays),
    attributionDays: Number(attributionDays),
    segmentId: segmentId || null,
  });

  const save = () =>
    act(async () => {
      if (editing) {
        await bffJson<JourneyDTO>(`${base}/${editing}`, { method: 'PATCH', body: JSON.stringify(payload()) });
        setNotice(t('journeys.updated'));
      } else {
        await bffJson<JourneyDTO>(base, { method: 'POST', body: JSON.stringify({ ...payload(), trigger }) });
        setNotice(t('journeys.saved'));
      }
      reset();
    });

  const edit = (journey: JourneyDTO) => {
    setEditing(journey.id);
    setName(journey.name);
    setTrigger(journey.trigger);
    setChannel(journey.channel);
    setSubject(journey.subject ?? '');
    setBody(journey.body);
    setDelayHours(String(journey.delayHours));
    setInactiveDays(String(journey.inactiveDays ?? JOURNEY_INACTIVE_DAYS.default));
    setCooldownDays(String(journey.cooldownDays));
    setAttributionDays(String(journey.attributionDays));
    setSegmentId(journey.segmentId ?? '');
    setError(null);
    setNotice(null);
  };

  const setStatus = (journey: JourneyDTO, status: JourneyDTO['status']) =>
    act(async () => {
      await bffJson<JourneyDTO>(`${base}/${journey.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setNotice(status === 'ACTIVE' ? t('journeys.activated') : t('journeys.pausedNotice'));
    });

  const remove = (id: string) =>
    act(async () => {
      await bffJson<void>(`${base}/${id}`, { method: 'DELETE' });
      if (editing === id) reset();
      setNotice(t('journeys.deleted'));
    });

  const bodyMax = channel === 'EMAIL' ? CAMPAIGN_EMAIL_BODY_MAX : CAMPAIGN_BODY_MAX;
  const valid =
    name.trim().length >= 2 && body.trim().length >= 5 && (channel !== 'EMAIL' || subject.trim().length >= 2);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('journeys.title')}</h1>
        <p className="ui-text-muted">{t('journeys.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {notice && <p className="pui-alert pui-success">{notice}</p>}

      {canManage && (
        <Card title={editing ? t('journeys.edit') : t('journeys.new')} aria-label={t('journeys.new')}>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label={t('journeys.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
            <SelectField
              label={t('journeys.trigger')}
              help={t(`journeys.trigger.help.${trigger}`)}
              value={trigger}
              onChange={(e) => pickTrigger(e.target.value as JourneyTrigger)}
              disabled={editing !== null}
            >
              {JOURNEY_TRIGGERS.map((key) => (
                <option key={key} value={key}>
                  {t(`journeys.trigger.${key}`)}
                </option>
              ))}
            </SelectField>
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
            {channel === 'EMAIL' && (
              <TextField
                label={t('journeys.subject')}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={CAMPAIGN_SUBJECT_MAX}
              />
            )}
            <TextAreaField
              className="md:col-span-2"
              label={t('journeys.body')}
              help={t('journeys.bodyHelp', TOKENS)}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={bodyMax}
              rows={channel === 'EMAIL' ? 8 : 4}
            />
            <div className="md:col-span-2">
              <Button
                variant="outline"
                tone="muted"
                onClick={() => setBody(t(`journeys.template.${trigger}`, TOKENS))}
                disabled={busy}
              >
                {t('journeys.useTemplate')}
              </Button>
            </div>
            <TextField
              label={t('journeys.delayHours')}
              type="number"
              min={JOURNEY_DELAY_HOURS.min}
              max={JOURNEY_DELAY_HOURS.max}
              value={delayHours}
              onChange={(e) => setDelayHours(e.target.value)}
            />
            {trigger === 'WIN_BACK' && (
              <TextField
                label={t('journeys.inactiveDays')}
                type="number"
                min={JOURNEY_INACTIVE_DAYS.min}
                max={JOURNEY_INACTIVE_DAYS.max}
                value={inactiveDays}
                onChange={(e) => setInactiveDays(e.target.value)}
              />
            )}
            <TextField
              label={t('journeys.cooldownDays')}
              help={t('journeys.cooldownHelp')}
              type="number"
              min={JOURNEY_COOLDOWN_DAYS.min}
              max={JOURNEY_COOLDOWN_DAYS.max}
              value={cooldownDays}
              onChange={(e) => setCooldownDays(e.target.value)}
            />
            <TextField
              label={t('journeys.attributionDays')}
              type="number"
              min={CAMPAIGN_ATTRIBUTION_DAYS.min}
              max={CAMPAIGN_ATTRIBUTION_DAYS.max}
              value={attributionDays}
              onChange={(e) => setAttributionDays(e.target.value)}
            />
            {segmentsV2 && (
              <SelectField
                label={t('journeys.segment')}
                value={segmentId}
                onChange={(e) => setSegmentId(e.target.value)}
              >
                <option value="">{t('journeys.segment.none')}</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={busy || !valid}>
              {editing ? t('journeys.update') : t('journeys.save')}
            </Button>
            {editing && (
              <Button variant="outline" tone="muted" onClick={reset} disabled={busy}>
                {t('journeys.cancelEdit')}
              </Button>
            )}
          </div>
          <p className="ui-caption">{t('journeys.rules')}</p>
        </Card>
      )}

      <Card title={t('journeys.list.title')} aria-label={t('journeys.list.title')}>
        {list && list.items.length === 0 && <p className="ui-text-muted">{t('journeys.list.empty')}</p>}
        {list && list.items.length > 0 && (
          <ul className="flex flex-col gap-3">
            {list.items.map((j) => (
              <li key={j.id} className="flex flex-col gap-1 ui-rule pt-3" aria-label={j.name}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="ui-heading">{j.name}</span>
                  <Badge tone={j.status === 'ACTIVE' ? 'success' : 'muted'}>{t(`journeys.status.${j.status}`)}</Badge>
                </div>
                <p className="ui-caption">
                  {t(`journeys.trigger.${j.trigger}`)}
                  {j.trigger === 'WIN_BACK' && j.inactiveDays !== null
                    ? `, ${t('journeys.summary.inactive', { days: j.inactiveDays })}`
                    : ''}
                  {', '}
                  {j.delayHours > 0 ? t('journeys.summary.delay', { hours: j.delayHours }) : t('journeys.summary.now')}
                  {', '}
                  {t(`campaigns.channel.${j.channel}`)}
                </p>
                <p className="ui-caption">{t('journeys.stats', { ...j.stats })}</p>
                <p className="ui-caption">
                  {t('journeys.conversions', {
                    count: j.stats.conversions,
                    amount: list
                      ? formatMoney({ amountMinor: j.stats.revenueMinor, currency: list.currency }, locale)
                      : '',
                  })}
                </p>
                {j.lastError && <p className="ui-caption">{t(`journeys.lastError.${j.lastError}`)}</p>}
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    {j.status === 'ACTIVE' ? (
                      <Button variant="outline" tone="muted" onClick={() => setStatus(j, 'PAUSED')} disabled={busy}>
                        {t('journeys.pause')}
                      </Button>
                    ) : (
                      <Button onClick={() => setStatus(j, 'ACTIVE')} disabled={busy}>
                        {t('journeys.activate')}
                      </Button>
                    )}
                    <Button variant="outline" tone="muted" onClick={() => edit(j)} disabled={busy}>
                      {t('journeys.editAction')}
                    </Button>
                    <Button variant="outline" tone="error" onClick={() => remove(j.id)} disabled={busy}>
                      {t('journeys.delete')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
