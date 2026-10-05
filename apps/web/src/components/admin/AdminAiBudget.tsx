'use client';

import { useEffect, useState } from 'react';
import { UpdateAiBudgetSchema } from '@resget/shared';
import type { AiBudgetDTO } from '@resget/shared';
import { Button, Card, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** One tenant's monthly AI studio token budget and this month's use (docs/YAPAY_ZEKA.md). */
export function AdminAiBudget({ restaurantId, locale }: { restaurantId: string; locale: string }) {
  const t = useT(locale);
  const path = `admin/ai-budgets/${restaurantId}`;
  const [budget, setBudget] = useState<AiBudgetDTO | null>(null);
  const [limit, setLimit] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const number = (n: number) => new Intl.NumberFormat(locale).format(n);

  const show = (row: AiBudgetDTO) => {
    setBudget(row);
    setLimit(String(row.monthlyTokenLimit));
  };
  useEffect(() => {
    bffJson<AiBudgetDTO>(path)
      .then(show)
      .catch(() => setBudget(null));
  }, [path]);

  if (!budget) return null;
  const save = async () => {
    setError(null);
    setSaved(false);
    const parsed = UpdateAiBudgetSchema.safeParse({ monthlyTokenLimit: Number(limit) });
    if (!limit.trim() || !parsed.success) {
      setError(t('ai.admin.invalid'));
      return;
    }
    try {
      show(await bffJson<AiBudgetDTO>(path, { method: 'PUT', body: JSON.stringify(parsed.data) }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    }
  };

  return (
    <Card title={t('ai.admin.title')} aria-label={t('ai.admin.title')}>
      <p className="ui-text-muted">{t('ai.admin.intro')}</p>
      <TextField
        label={t('ai.admin.limit')}
        type="number"
        min={0}
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
      />
      <p className="ui-caption" data-ai-used>
        {t('ai.admin.used', { used: number(budget.usedThisMonth), remaining: number(budget.remaining) })}
      </p>
      <div>
        <Button onClick={() => void save()}>{t('ai.admin.save')}</Button>
      </div>
      {saved && <p role="status">{t('ai.admin.saved')}</p>}
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
    </Card>
  );
}
