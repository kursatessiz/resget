'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ContactTaskDTO } from '@resget/shared';
import { Badge, Button, Card } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** Open CRM tasks of the tenant, due first, optionally only the caller's (docs/CRM.md). */
export function CrmTasks({
  restaurantId,
  locale,
  canManage,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/crm`;
  const [mine, setMine] = useState(false);
  const [tasks, setTasks] = useState<ContactTaskDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      bffJson<ContactTaskDTO[]>(`${base}/tasks${mine ? '?mine=true' : ''}`)
        .then(setTasks)
        .catch((err: unknown) =>
          setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
        ),
    [base, mine, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const done = async (id: string) => {
    await bffJson(`${base}/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) }).catch(
      () => undefined,
    );
    await load();
  };

  return (
    <Card title={t('crm.tasks.title')} aria-label={t('crm.tasks.title')}>
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="pui-checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          <span>{t('crm.tasks.mine')}</span>
        </label>
        {error && <p role="alert">{error}</p>}
        {tasks && tasks.length === 0 && <p className="ui-text-muted">{t('crm.tasks.empty')}</p>}
        <ul className="ui-divide">
          {tasks?.map((task) => {
            const overdue = task.dueAt !== null && new Date(task.dueAt).getTime() < Date.now();
            return (
              <li
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
                data-task={task.title}
              >
                <span className="flex flex-col">
                  <span>{task.title}</span>
                  <span className="ui-caption">
                    {task.contactName}
                    {task.dueAt ? ` / ${t('crm.tasks.due', { time: time.format(new Date(task.dueAt)) })}` : ''}
                    {task.assignee ? ` / ${task.assignee.fullName}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {overdue && <Badge tone="error">{t('crm.tasks.overdue')}</Badge>}
                  {canManage && (
                    <Button variant="outline" tone="muted" onClick={() => void done(task.id)}>
                      {t('crm.tasks.done')}
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
