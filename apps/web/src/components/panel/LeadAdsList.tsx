'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { MetaLeadDTO, MetaLeadPageDTO, MetaLeadStatus } from '@resget/shared';
import { Badge, Button, Card } from '@/components/ui';
import type { UiTone } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const STATUS_TONE: Record<MetaLeadStatus, UiTone> = {
  RECEIVED: 'muted',
  IMPORTED: 'success',
  SKIPPED: 'warn',
  FAILED: 'error',
};

/**
 * Leads from Lead Ads forms (docs/LEAD_ADS.md): when each arrived, the
 * contact it became and its import status. Skipped and failed ones can be
 * tried again by someone who manages integrations.
 */
export function LeadAdsList({
  restaurantId,
  locale,
  canRetry,
  pipelineHref,
}: {
  restaurantId: string;
  locale: string;
  canRetry: boolean;
  /** The sales pipeline screen where imported contacts are worked on. */
  pipelineHref: string;
}) {
  const t = useT(locale);
  const [data, setData] = useState<MetaLeadPageDTO | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const load = useCallback(
    () =>
      bffJson<MetaLeadPageDTO>(`restaurants/${restaurantId}/lead-ads/leads?page=${page}`)
        .then((next) => {
          setData(next);
          setError(null);
        })
        .catch(fail),
    [restaurantId, page, fail],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const retry = async (lead: MetaLeadDTO) => {
    setBusy(true);
    try {
      await bffJson<MetaLeadDTO>(`restaurants/${restaurantId}/lead-ads/leads/${lead.id}/retry`, { method: 'POST' });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Card
      title={t('leadAds.title')}
      aria-label={t('leadAds.title')}
      aside={
        <span className="flex flex-wrap gap-2">
          <Button variant="outline" tone="muted" onClick={() => void load()}>
            {t('leadAds.refresh')}
          </Button>
          <Link href={pipelineHref} className="pui-btn pui-link pui-theme">
            {t('leadAds.openPipeline')}
          </Link>
        </span>
      }
    >
      <p className="ui-text-muted">{t('leadAds.intro')}</p>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {data && data.items.length === 0 && <p className="ui-caption">{t('leadAds.empty')}</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="pui-table w-full">
            <thead>
              <tr>
                <th scope="col">{t('leadAds.column.received')}</th>
                <th scope="col">{t('leadAds.column.contact')}</th>
                <th scope="col">{t('leadAds.column.page')}</th>
                <th scope="col">{t('leadAds.column.status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((lead) => (
                <tr key={lead.id} data-lead={lead.leadgenId}>
                  <td>{when(lead.receivedAt)}</td>
                  <td>{lead.contactName ?? <span className="ui-caption">{t('leadAds.noContact')}</span>}</td>
                  <td>{lead.pageName ?? t('leadAds.unknownPage')}</td>
                  <td>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS_TONE[lead.status]}>{t(`leadAds.status.${lead.status}`)}</Badge>
                      {lead.reason && <span className="ui-caption">{t(`leadAds.reason.${lead.reason}`)}</span>}
                      {canRetry && (lead.status === 'FAILED' || lead.status === 'SKIPPED') && (
                        <Button variant="outline" tone="muted" disabled={busy} onClick={() => void retry(lead)}>
                          {t('leadAds.retry')}
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && pages > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" tone="muted" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('leadAds.previous')}
          </Button>
          <span className="ui-caption">{t('leadAds.pagination', { page, pages })}</span>
          <Button variant="outline" tone="muted" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            {t('leadAds.next')}
          </Button>
        </div>
      )}
    </Card>
  );
}
