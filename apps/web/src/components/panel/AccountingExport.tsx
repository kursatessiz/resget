'use client';

import { useState } from 'react';
import { Card, LinkButton, TextField } from '@/components/ui';
import { useT } from '@/lib/use-t';

/** "YYYY-MM" of the UTC month before now: the month an accountant usually asks for. */
function previousMonth(now: Date): string {
  const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const month = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Month picker and the two CSV downloads of the accounting export (docs/MUHASEBE_AKTARIMI.md). */
export function AccountingExport({ restaurantId, locale }: { restaurantId: string; locale: string }) {
  const t = useT(locale);
  const [month, setMonth] = useState(() => previousMonth(new Date()));
  const [year, monthNumber] = month.split('-');
  const query = `year=${Number(year)}&month=${Number(monthNumber)}`;
  const base = `/api/bff/restaurants/${restaurantId}/accounting`;
  const valid = /^\d{4}-\d{2}$/.test(month);
  return (
    <Card title={t('accounting.title')} aria-label={t('accounting.title')}>
      <div className="flex flex-col gap-3">
        <p className="ui-text-muted">{t('accounting.intro')}</p>
        <TextField
          type="month"
          label={t('accounting.month')}
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          className="max-w-xs"
        />
        {valid && (
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`${base}/orders.csv?${query}`} variant="outline" tone="theme">
              {t('accounting.orders')}
            </LinkButton>
            <LinkButton href={`${base}/lines.csv?${query}`} variant="outline" tone="muted">
              {t('accounting.lines')}
            </LinkButton>
          </div>
        )}
        <p className="ui-caption">{t('accounting.note')}</p>
      </div>
    </Card>
  );
}
