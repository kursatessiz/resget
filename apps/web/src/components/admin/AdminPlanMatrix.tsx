'use client';

import { useMemo, useState } from 'react';
import { FEATURES, PLAN_FEATURES, PLAN_MATRIX_KEYS } from '@resget/shared';
import type { EntitlementKey, FeatureGroup, PlanDTO, PlanFeaturesChangeDTO } from '@resget/shared';
import { Button, Card } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { entitlementLabel, planLabel } from '@/lib/plans';
import { useT } from '@/lib/use-t';

type RowGroup = 'plan' | FeatureGroup;
const GROUP_ORDER: RowGroup[] = ['plan', 'ordering', 'payments', 'delivery', 'marketing', 'integrations'];

function groupOf(key: EntitlementKey): RowGroup {
  return (PLAN_FEATURES as readonly string[]).includes(key) ? 'plan' : FEATURES[key as keyof typeof FEATURES].group;
}

/**
 * The plan matrix (docs/PLAN_MATRISI.md): one column per plan, one row per
 * feature or module. Saving sends each changed plan's list; the API keeps a
 * removed key for the restaurants on that plan until their period ends.
 */
export function AdminPlanMatrix({
  locale,
  plans,
  onSaved,
}: {
  locale: string;
  plans: PlanDTO[];
  onSaved: (plans: PlanDTO[]) => void;
}) {
  const t = useT(locale);
  const [draft, setDraft] = useState<Record<string, EntitlementKey[]>>(() =>
    Object.fromEntries(plans.map((p) => [p.id, p.features])),
  );
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () => GROUP_ORDER.map((group) => ({ group, keys: PLAN_MATRIX_KEYS.filter((key) => groupOf(key) === group) })),
    [],
  );

  const changed = plans.filter((p) => {
    const next = draft[p.id] ?? p.features;
    return next.length !== p.features.length || next.some((key) => !p.features.includes(key));
  });

  const toggle = (planId: string, key: EntitlementKey, on: boolean) =>
    setDraft((current) => {
      const list = current[planId] ?? plans.find((p) => p.id === planId)?.features ?? [];
      return { ...current, [planId]: on ? [...list, key] : list.filter((k) => k !== key) };
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    setResults([]);
    try {
      if (changed.length === 0) {
        setResults([t('admin.planMatrix.unchanged')]);
        return;
      }
      const lines: string[] = [];
      for (const plan of changed) {
        const result = await bffJson<PlanFeaturesChangeDTO>(`admin/plans/${plan.id}/features`, {
          method: 'PUT',
          body: JSON.stringify({ features: draft[plan.id] }),
        });
        lines.push(
          t('admin.planMatrix.result', {
            plan: planLabel(t, plan.code, plan.name),
            added: result.added.length,
            removed: result.removed.length,
            grace: result.graceGranted,
          }),
        );
      }
      const fresh = await bffJson<PlanDTO[]>('admin/plans');
      setDraft(Object.fromEntries(fresh.map((p) => [p.id, p.features])));
      onSaved(fresh);
      setResults(lines);
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('admin.planMatrix.title')} aria-label={t('admin.planMatrix.title')}>
      <p className="ui-text-muted">{t('admin.planMatrix.intro')}</p>
      <p className="ui-caption">
        {t('admin.planMatrix.core')} {t('admin.planMatrix.switchNote')}
      </p>
      <div className="overflow-x-auto">
        <table className="pui-table w-full" aria-label={t('admin.planMatrix.title')}>
          <thead>
            <tr>
              <th scope="col">{t('admin.planMatrix.feature')}</th>
              {plans.map((plan) => (
                <th key={plan.id} scope="col" data-plan-column={plan.code}>
                  {planLabel(t, plan.code, plan.name)}
                </th>
              ))}
            </tr>
          </thead>
          {rows.map(({ group, keys }) =>
            keys.length === 0 ? null : (
              <tbody key={group}>
                <tr>
                  <th scope="rowgroup" colSpan={plans.length + 1} className="ui-caption">
                    {group === 'plan' ? t('admin.planMatrix.group.plan') : t(`admin.features.group.${group}`)}
                  </th>
                </tr>
                {keys.map((key) => (
                  <tr key={key} data-matrix-row={key}>
                    <th scope="row">{entitlementLabel(t, key)}</th>
                    {plans.map((plan) => (
                      <td key={plan.id}>
                        <input
                          type="checkbox"
                          className="pui-checkbox"
                          aria-label={`${planLabel(t, plan.code, plan.name)}: ${entitlementLabel(t, key)}`}
                          data-matrix-cell={`${plan.code}:${key}`}
                          checked={(draft[plan.id] ?? plan.features).includes(key)}
                          onChange={(e) => toggle(plan.id, key, e.target.checked)}
                          disabled={busy}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ),
          )}
        </table>
      </div>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}
      {results.map((line) => (
        <p key={line} className="ui-caption" data-matrix-result>
          {line}
        </p>
      ))}
      <div>
        <Button onClick={() => void save()} disabled={busy}>
          {t('admin.planMatrix.save')}
        </Button>
      </div>
    </Card>
  );
}
