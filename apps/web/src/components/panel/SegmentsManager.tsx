'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CONSENT_CHANNELS, SEGMENT_KINDS, SegmentRuleSchema } from '@resget/shared';
import type {
  PipelineDTO,
  SegmentDTO,
  SegmentGroup,
  SegmentKind,
  SegmentListDTO,
  SegmentPreviewDTO,
} from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';
import { SegmentBuilder, newCondition } from './SegmentBuilder';
import type { StageOption } from './SegmentBuilder';

const emptyRule = (): SegmentGroup => ({ op: 'AND', rules: [newCondition('orderCount')] });

/**
 * Saved audiences (docs/SEGMENTLER.md): build an AND / OR rule, preview who
 * it matches and how many each channel can reach, save it as dynamic or
 * static, retake a static snapshot, edit or delete.
 */
export function SegmentsManager({
  restaurantId,
  locale,
  canManage,
  withStages,
  withChurn,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
  /** CRM is on and the viewer may see the pipeline: stages become a field. */
  withStages: boolean;
  /** The churn_signals module is on: the stored churn class becomes a field. */
  withChurn: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/segments`;
  const [list, setList] = useState<SegmentListDTO | null>(null);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SegmentKind>('DYNAMIC');
  const [rule, setRule] = useState<SegmentGroup>(emptyRule);
  const [preview, setPreview] = useState<SegmentPreviewDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const valid = useMemo(() => SegmentRuleSchema.safeParse(rule).success, [rule]);

  const load = useCallback(async () => {
    setList(await bffJson<SegmentListDTO>(base));
  }, [base]);

  useEffect(() => {
    load().catch(fail);
  }, [load, fail]);

  useEffect(() => {
    if (!withStages) return;
    bffJson<PipelineDTO>(`restaurants/${restaurantId}/crm/pipeline`)
      .then((pipeline) =>
        setStages(
          pipeline.stages.map((s) => ({
            id: s.id,
            label: s.name ?? (s.key ? t(`crm.stage.${s.key}`) : ''),
          })),
        ),
      )
      .catch(() => setStages([]));
  }, [withStages, restaurantId, t]);

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
    setKind('DYNAMIC');
    setRule(emptyRule());
    setPreview(null);
  };

  const changeRule = (next: SegmentGroup) => {
    setRule(next);
    setPreview(null);
  };

  const runPreview = () =>
    act(async () => {
      setPreview(
        await bffJson<SegmentPreviewDTO>(`${base}/preview`, { method: 'POST', body: JSON.stringify({ rule }) }),
      );
    });

  const save = () =>
    act(async () => {
      if (editing) {
        await bffJson<SegmentDTO>(`${base}/${editing}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: name.trim(), rule }),
        });
        setNotice(t('segments.updated'));
      } else {
        await bffJson<SegmentDTO>(base, { method: 'POST', body: JSON.stringify({ name: name.trim(), kind, rule }) });
        setNotice(t('segments.saved'));
      }
      reset();
    });

  const edit = (segment: SegmentDTO) => {
    setEditing(segment.id);
    setName(segment.name);
    setKind(segment.kind);
    setRule(segment.rule);
    setPreview(null);
    setError(null);
    setNotice(null);
  };

  const snapshot = (id: string) =>
    act(async () => {
      await bffJson<SegmentDTO>(`${base}/${id}/snapshot`, { method: 'POST', body: '{}' });
      setNotice(t('segments.snapshotTaken'));
    });

  const remove = (id: string) =>
    act(async () => {
      await bffJson<void>(`${base}/${id}`, { method: 'DELETE' });
      if (editing === id) reset();
      setNotice(t('segments.deleted'));
    });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('segments.title')}</h1>
        <p className="ui-text-muted">{t('segments.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {notice && <p className="pui-alert pui-success">{notice}</p>}

      {list && (
        <Card title={editing ? t('segments.edit') : t('segments.new')} aria-label={t('segments.builder')}>
          <SegmentBuilder
            value={rule}
            onChange={changeRule}
            locale={locale}
            stages={stages}
            currency={list.currency}
            withChurn={withChurn}
          />
          {!valid && <p className="ui-caption">{t('segments.invalid')}</p>}
          <div>
            <Button variant="outline" tone="muted" onClick={runPreview} disabled={busy || !valid}>
              {t('segments.preview')}
            </Button>
          </div>
          {preview && (
            <section className="flex flex-col gap-2" aria-label={t('segments.preview')}>
              <p role="status" className="ui-heading">
                {t('segments.preview.count', { count: preview.count })}
              </p>
              <ul className="flex flex-wrap gap-2">
                {CONSENT_CHANNELS.map((channel) => (
                  <li key={channel}>
                    <Badge tone="muted">
                      {t('segments.preview.reachable', {
                        channel: t(`segments.channel.${channel}`),
                        count: preview.reachable[channel] ?? 0,
                      })}
                    </Badge>
                  </li>
                ))}
              </ul>
              {preview.sample.length > 0 && (
                <>
                  <p className="ui-caption">{t('segments.preview.sample')}</p>
                  <ul className="flex flex-col gap-1">
                    {preview.sample.map((s) => (
                      <li key={s.id} className="flex flex-wrap justify-between gap-2">
                        <span>{s.fullName ?? t('segments.preview.hidden')}</span>
                        <span className="ui-caption">
                          {t('segments.preview.orders', { count: s.orderCount })}
                          {', '}
                          {s.lastOrderAt
                            ? t('segments.preview.lastOrder', { date: when(s.lastOrderAt) })
                            : t('segments.preview.never')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
          {canManage && (
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <TextField
                label={t('segments.name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
              />
              <SelectField
                label={t('segments.kind')}
                value={kind}
                onChange={(e) => setKind(e.target.value as SegmentKind)}
                disabled={editing !== null}
              >
                {SEGMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`segments.kind.${k}`)}
                  </option>
                ))}
              </SelectField>
              <Button onClick={save} disabled={busy || !valid || name.trim().length < 2}>
                {editing ? t('segments.update') : t('segments.save')}
              </Button>
              {editing && (
                <Button variant="outline" tone="muted" onClick={reset} disabled={busy}>
                  {t('segments.cancelEdit')}
                </Button>
              )}
            </div>
          )}
          {canManage && <p className="ui-caption">{t(`segments.kind.help.${kind}`)}</p>}
        </Card>
      )}

      <Card title={t('segments.list.title')} aria-label={t('segments.list.title')}>
        {list && list.items.length === 0 && <p className="ui-text-muted">{t('segments.list.empty')}</p>}
        {list && list.items.length > 0 && (
          <ul className="flex flex-col gap-3">
            {list.items.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 ui-rule pt-3" aria-label={s.name}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="ui-heading">{s.name}</span>
                  <Badge tone={s.kind === 'STATIC' ? 'warn' : 'success'}>{t(`segments.kind.${s.kind}`)}</Badge>
                </div>
                <p className="ui-caption">
                  {t('segments.count', { count: s.count })}
                  {s.kind === 'STATIC' && s.snapshotAt && `. ${t('segments.snapshotAt', { date: when(s.snapshotAt) })}`}
                </p>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" tone="muted" onClick={() => edit(s)} disabled={busy}>
                      {t('segments.editAction')}
                    </Button>
                    {s.kind === 'STATIC' && (
                      <Button variant="outline" tone="muted" onClick={() => snapshot(s.id)} disabled={busy}>
                        {t('segments.snapshot')}
                      </Button>
                    )}
                    <Button variant="outline" tone="error" onClick={() => remove(s.id)} disabled={busy}>
                      {t('segments.delete')}
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
