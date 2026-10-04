'use client';

import { useCallback, useEffect, useState } from 'react';
import { MANUAL_ACTIVITY_TYPES } from '@resget/shared';
import type { ContactCardDTO, ContactDetailDTO, PipelineDTO, PipelineStageDTO } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

type ManualType = (typeof MANUAL_ACTIVITY_TYPES)[number];

/**
 * The pipeline board (docs/CRM.md): one column per stage, a card per
 * contact, a form for a new prospect and a contact card with its history
 * and tasks. Moving a contact is a stage choice on its card, so the board
 * works with a keyboard and on a phone.
 */
export function CrmBoard({
  restaurantId,
  locale,
  canManage,
  canExport,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
  canExport: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/crm`;
  const [pipeline, setPipeline] = useState<PipelineDTO | null>(null);
  const [open, setOpen] = useState<ContactDetailDTO | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    company: '',
    city: '',
    district: '',
    source: '',
    stageId: '',
  });
  const [log, setLog] = useState<{ type: ManualType; body: string }>({ type: 'CALL', body: '' });
  const [task, setTask] = useState({ title: '', dueAt: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const load = useCallback(() => bffJson<PipelineDTO>(`${base}/pipeline`).then(setPipeline).catch(fail), [base, fail]);
  const openContact = useCallback(
    (id: string) => bffJson<ContactDetailDTO>(`${base}/contacts/${id}`).then(setOpen).catch(fail),
    [base, fail],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      after?.();
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  if (!pipeline) return error ? <p role="alert">{error}</p> : null;
  const stageLabel = (stage: PipelineStageDTO) => stage.name ?? (stage.key ? t(`crm.stage.${stage.key}`) : '');
  const columns: { id: string; label: string }[] = [
    ...pipeline.stages.map((s) => ({ id: s.id, label: stageLabel(s) })),
    ...((pipeline.contacts.none ?? []).length > 0 ? [{ id: 'none', label: t('crm.pipeline.none') }] : []),
  ];
  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });

  const card = (contact: ContactCardDTO) => (
    <li key={contact.id} className="flex flex-col gap-1 py-2" data-contact={contact.fullName}>
      <span className="ui-heading">{contact.fullName}</span>
      {contact.company && <span className="ui-caption">{contact.company}</span>}
      <span className="ui-caption">{contact.phone}</span>
      <span className="flex flex-wrap gap-1">
        {contact.orderCount > 0 && (
          <Badge tone="success">
            {t(contact.orderCount === 1 ? 'crm.card.orders.one' : 'crm.card.orders.other', {
              count: contact.orderCount,
            })}
          </Badge>
        )}
        {contact.openTasks > 0 && (
          <Badge tone="warn">
            {t(contact.openTasks === 1 ? 'crm.card.tasks.one' : 'crm.card.tasks.other', { count: contact.openTasks })}
          </Badge>
        )}
      </span>
      <div>
        <Button variant="link" onClick={() => void openContact(contact.id)}>
          {t('crm.card.open')}
        </Button>
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="ui-title">{t('crm.pipeline.title')}</h1>
        {canExport && (
          <a className="pui-btn pui-outline pui-muted" href={`/api/bff/${base}/export.csv`} download>
            {t('crm.pipeline.export')}
          </a>
        )}
      </div>
      <p className="ui-text-muted">{t('crm.pipeline.intro')}</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {columns.map((column) => {
          const contacts = pipeline.contacts[column.id] ?? [];
          return (
            <Card
              key={column.id}
              title={`${column.label} (${contacts.length})`}
              aria-label={column.label}
              data-stage={column.id}
            >
              {contacts.length === 0 ? (
                <p className="ui-caption">{t('crm.pipeline.empty')}</p>
              ) : (
                <ul className="ui-divide">{contacts.map(card)}</ul>
              )}
            </Card>
          );
        })}
      </div>

      {open && (
        <Card
          title={`${t('crm.detail.title')}: ${open.contact.fullName}`}
          aria-label={t('crm.detail.title')}
          aside={
            <Button variant="link" onClick={() => setOpen(null)}>
              {t('crm.detail.close')}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                id="crm-detail-stage"
                label={t('crm.detail.stage')}
                value={open.contact.stageId ?? ''}
                disabled={!canManage || busy}
                onChange={(event) =>
                  void run(
                    () =>
                      bffJson(`${base}/contacts/${open.contact.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ stageId: event.target.value || null }),
                      }),
                    () => void openContact(open.contact.id),
                  )
                }
              >
                <option value="">{t('crm.pipeline.none')}</option>
                {pipeline.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {stageLabel(s)}
                  </option>
                ))}
              </SelectField>
              <SelectField
                id="crm-detail-owner"
                label={t('crm.detail.owner')}
                value={open.contact.owner?.membershipId ?? ''}
                disabled={!canManage || busy}
                onChange={(event) =>
                  void run(
                    () =>
                      bffJson(`${base}/contacts/${open.contact.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ ownerMembershipId: event.target.value || null }),
                      }),
                    () => void openContact(open.contact.id),
                  )
                }
              >
                <option value="">{t('crm.detail.noOwner')}</option>
                {pipeline.owners.map((o) => (
                  <option key={o.membershipId} value={o.membershipId}>
                    {o.fullName}
                  </option>
                ))}
              </SelectField>
            </div>

            <section className="flex flex-col gap-2" aria-label={t('crm.detail.tasks')}>
              <span className="ui-heading">{t('crm.detail.tasks')}</span>
              <ul className="ui-divide">
                {open.tasks.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {item.title}
                      {item.dueAt ? ` / ${time.format(new Date(item.dueAt))}` : ''}
                    </span>
                    {item.doneAt ? (
                      <Badge tone="success">{t('crm.tasks.done')}</Badge>
                    ) : (
                      canManage && (
                        <Button
                          variant="outline"
                          tone="muted"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                bffJson(`${base}/tasks/${item.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ done: true }),
                                }),
                              () => void openContact(open.contact.id),
                            )
                          }
                        >
                          {t('crm.tasks.done')}
                        </Button>
                      )
                    )}
                  </li>
                ))}
              </ul>
              {canManage && (
                <div className="flex flex-wrap items-end gap-2">
                  <TextField
                    id="crm-task-title"
                    label={t('crm.detail.taskTitle')}
                    value={task.title}
                    onChange={(e) => setTask({ ...task, title: e.target.value })}
                  />
                  <TextField
                    id="crm-task-due"
                    label={t('crm.detail.taskDue')}
                    type="datetime-local"
                    value={task.dueAt}
                    onChange={(e) => setTask({ ...task, dueAt: e.target.value })}
                  />
                  <Button
                    disabled={busy || task.title.trim() === ''}
                    onClick={() =>
                      void run(
                        () =>
                          bffJson(`${base}/contacts/${open.contact.id}/tasks`, {
                            method: 'POST',
                            body: JSON.stringify({
                              title: task.title.trim(),
                              ...(task.dueAt ? { dueAt: new Date(task.dueAt).toISOString() } : {}),
                            }),
                          }),
                        () => {
                          setTask({ title: '', dueAt: '' });
                          void openContact(open.contact.id);
                        },
                      )
                    }
                  >
                    {t('crm.detail.taskSubmit')}
                  </Button>
                </div>
              )}
            </section>

            <section className="flex flex-col gap-2" aria-label={t('crm.detail.history')}>
              <span className="ui-heading">{t('crm.detail.history')}</span>
              {canManage && (
                <div className="flex flex-wrap items-end gap-2">
                  <SelectField
                    id="crm-log-type"
                    label={t('crm.detail.logType')}
                    value={log.type}
                    onChange={(e) => setLog({ ...log, type: e.target.value as ManualType })}
                  >
                    {MANUAL_ACTIVITY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`crm.activity.${type}`)}
                      </option>
                    ))}
                  </SelectField>
                  <TextField
                    id="crm-log-body"
                    label={t('crm.detail.logBody')}
                    value={log.body}
                    maxLength={2000}
                    onChange={(e) => setLog({ ...log, body: e.target.value })}
                  />
                  <Button
                    disabled={busy || log.body.trim() === ''}
                    onClick={() =>
                      void run(
                        () =>
                          bffJson(`${base}/contacts/${open.contact.id}/activities`, {
                            method: 'POST',
                            body: JSON.stringify({ type: log.type, body: log.body.trim() }),
                          }),
                        () => {
                          setLog({ ...log, body: '' });
                          void openContact(open.contact.id);
                        },
                      )
                    }
                  >
                    {t('crm.detail.logSubmit')}
                  </Button>
                </div>
              )}
              <ul className="ui-divide">
                {open.activities.map((activity) => (
                  <li key={activity.id} className="flex flex-col gap-1 py-2" data-activity={activity.type}>
                    <span className="ui-caption">
                      {t(`crm.activity.${activity.type}`)} / {time.format(new Date(activity.createdAt))}
                      {activity.actorName ? ` / ${activity.actorName}` : ''}
                    </span>
                    {activity.body && <span>{activity.body}</span>}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </Card>
      )}

      {canManage && (
        <Card title={t('crm.new.title')} aria-label={t('crm.new.title')}>
          <form
            className="grid gap-3 md:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () =>
                  bffJson(`${base}/contacts`, {
                    method: 'POST',
                    body: JSON.stringify(
                      Object.fromEntries(
                        Object.entries(form)
                          .filter(([, value]) => value.trim() !== '')
                          .map(([k, v]) => [k, v.trim()]),
                      ),
                    ),
                  }),
                () => {
                  setForm({ fullName: '', phone: '', company: '', city: '', district: '', source: '', stageId: '' });
                  setNotice(t('crm.new.done'));
                },
              );
            }}
          >
            {(['fullName', 'phone', 'company', 'city', 'district', 'source'] as const).map((field) => (
              <TextField
                key={field}
                id={`crm-new-${field}`}
                label={t(`crm.new.${field}`)}
                value={form[field]}
                inputMode={field === 'phone' ? 'tel' : undefined}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              />
            ))}
            <SelectField
              id="crm-new-stage"
              label={t('crm.new.stage')}
              value={form.stageId}
              onChange={(e) => setForm({ ...form, stageId: e.target.value })}
            >
              <option value="">{t('crm.pipeline.none')}</option>
              {pipeline.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {stageLabel(s)}
                </option>
              ))}
            </SelectField>
            <div className="md:col-span-3">
              <Button type="submit" disabled={busy || form.fullName.trim().length < 2 || form.phone.trim() === ''}>
                {t('crm.new.submit')}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
