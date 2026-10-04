'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { HEALTH_LEVELS, SIGNAL_DROP_WINDOW_DAYS } from '@resget/shared';
import type { HealthLevel, RestaurantHealthPageDTO } from '@resget/shared';
import { Badge, Card } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const LEVEL_TONE: Record<HealthLevel, UiTone> = { HIGH: 'error', MEDIUM: 'warn', LOW: 'muted' };

/** Restaurants with a churn signal, the riskiest first, each with its signals and recent orders. */
export function AdminRestaurantHealth({ locale }: { locale: string }) {
  const t = useT(locale);
  const [page, setPage] = useState<RestaurantHealthPageDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  useEffect(() => {
    bffJson<RestaurantHealthPageDTO>('admin/restaurant-health').then(setPage).catch(fail);
  }, [fail]);

  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('churn.health.title')}</h1>
        <p className="ui-text-muted">{t('churn.health.intro', { days: SIGNAL_DROP_WINDOW_DAYS })}</p>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {page && (
        <Card>
          <div className="flex flex-wrap gap-3" data-health-counts>
            <span className="ui-caption">{t('churn.health.checked', { count: page.checked })}</span>
            {HEALTH_LEVELS.map((level) => (
              <Badge key={level} tone={LEVEL_TONE[level]}>
                {t(`churn.health.level.${level}`)}: {page.counts[level]}
              </Badge>
            ))}
          </div>
          {page.items.length === 0 ? (
            <p className="ui-text-muted">{t('churn.health.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="pui-table w-full">
                <thead>
                  <tr>
                    <th scope="col">{t('churn.health.restaurant')}</th>
                    <th scope="col">{t('churn.health.levelLabel')}</th>
                    <th scope="col">{t('churn.health.signals')}</th>
                    <th scope="col">{t('churn.health.lastOrder')}</th>
                    <th scope="col">{t('churn.health.orders')}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((item) => (
                    <tr key={item.id} data-health-row={item.slug}>
                      <td>
                        <Link href={`/admin/restoranlar/${item.id}`} className="pui-btn pui-link pui-theme">
                          {item.name}
                        </Link>
                      </td>
                      <td>
                        <Badge tone={LEVEL_TONE[item.level]}>{t(`churn.health.level.${item.level}`)}</Badge>
                      </td>
                      <td>
                        <ul className="flex flex-col gap-1">
                          {item.signals.map((signal) => (
                            <li key={signal} data-health-signal={signal}>
                              {t(`churn.signal.${signal}`)}
                              {signal === 'TRIAL_ENDING' && item.trialEndsAt && (
                                <span className="ui-caption"> {date(item.trialEndsAt)}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td>{item.lastOrderAt ? date(item.lastOrderAt) : t('churn.health.never')}</td>
                      <td>
                        {t('churn.health.windows', {
                          current: item.ordersLastWindow,
                          previous: item.ordersPreviousWindow,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
