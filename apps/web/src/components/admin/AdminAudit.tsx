'use client';

import { useCallback, useEffect, useState } from 'react';
import { AuditQuerySchema, PLATFORM_TENANT_SLUG } from '@resget/shared';
import type { AuditPageDTO } from '@resget/shared';
import { Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

interface Filters {
  restaurant: string;
  action: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { restaurant: '', action: '', from: '', to: '' };

/** The console's audit viewer: who did what, where and when, newest first, filtered and paged. */
export function AdminAudit({ locale }: { locale: string }) {
  const t = useT(locale);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditPageDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  useEffect(() => {
    const params = new URLSearchParams({ page: String(page) });
    for (const [key, value] of Object.entries(applied)) if (value.trim()) params.set(key, value.trim());
    setError(null);
    bffJson<AuditPageDTO>(`admin/audit?${params.toString()}`).then(setData).catch(fail);
  }, [applied, page, fail]);

  const apply = (next: Filters) => {
    const query = Object.fromEntries(Object.entries(next).filter(([, v]) => v.trim()));
    if (!AuditQuerySchema.safeParse(query).success) {
      setError(t('approvals.audit.invalid'));
      return;
    }
    setDraft(next);
    setApplied(next);
    setPage(1);
  };
  const time = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(iso));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('approvals.audit.title')}</h1>
        <p className="ui-text-muted">{t('approvals.audit.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      <Card title={t('approvals.audit.filters')} aria-label={t('approvals.audit.filters')}>
        <div className="grid gap-3 md:grid-cols-4">
          <TextField
            label={t('approvals.audit.restaurant')}
            value={draft.restaurant}
            onChange={(e) => setDraft({ ...draft, restaurant: e.target.value })}
          />
          <TextField
            label={t('approvals.audit.action')}
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
          />
          <TextField
            label={t('approvals.audit.from')}
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
          <TextField
            label={t('approvals.audit.to')}
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => apply(draft)}>{t('approvals.audit.apply')}</Button>
          <Button
            variant="outline"
            tone="muted"
            onClick={() => apply({ ...EMPTY, restaurant: PLATFORM_TENANT_SLUG, action: 'campaign.' })}
          >
            {t('approvals.audit.platformSends')}
          </Button>
          <Button variant="outline" tone="muted" onClick={() => apply(EMPTY)}>
            {t('approvals.audit.clear')}
          </Button>
        </div>
      </Card>
      {data && (
        <Card
          title={t('approvals.audit.results', { count: data.total })}
          aria-label={t('approvals.audit.resultsLabel')}
        >
          {data.items.length === 0 ? (
            <p className="ui-text-muted">{t('approvals.audit.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="pui-table w-full">
                <thead>
                  <tr>
                    <th scope="col">{t('approvals.audit.time')}</th>
                    <th scope="col">{t('approvals.audit.actionColumn')}</th>
                    <th scope="col">{t('approvals.audit.restaurantColumn')}</th>
                    <th scope="col">{t('approvals.audit.actor')}</th>
                    <th scope="col">{t('approvals.audit.details')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id} data-audit-action={item.action}>
                      <td>{time(item.createdAt)}</td>
                      <td>
                        <code>{item.action}</code>
                        <span className="ui-caption block">
                          {item.entity}
                          {item.entityId ? ` ${item.entityId}` : ''}
                        </span>
                      </td>
                      <td>{item.restaurant ? item.restaurant.name : t('approvals.audit.none')}</td>
                      <td>{item.actor ? item.actor.fullName : t('approvals.audit.system')}</td>
                      <td>
                        <span className="ui-caption break-all">{item.meta ?? ''}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" tone="muted" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t('approvals.audit.previous')}
            </Button>
            <span className="ui-caption">{t('approvals.audit.page', { page, pages })}</span>
            <Button variant="outline" tone="muted" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              {t('approvals.audit.next')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
