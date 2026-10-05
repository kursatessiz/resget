'use client';

import { useCallback, useEffect, useState } from 'react';
import { PLAN_MATRIX_KEYS } from '@resget/shared';
import type { EntitlementKey, PlanDTO, RestaurantEntitlementsDTO } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { entitlementLabel, planLabel } from '@/lib/plans';
import { useT } from '@/lib/use-t';

/**
 * One restaurant's plan and the access it holds beyond it (docs/PLAN_MATRISI.md):
 * grace left by a plan change, and the console's "plan dışı açık" exceptions.
 */
export function AdminRestaurantEntitlements({ restaurantId, locale }: { restaurantId: string; locale: string }) {
  const t = useT(locale);
  const base = `admin/restaurants/${restaurantId}/entitlements`;
  const [data, setData] = useState<RestaurantEntitlementsDTO | null>(null);
  const [key, setKey] = useState<EntitlementKey | ''>('');
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const [plans, setPlans] = useState<PlanDTO[]>([]);
  const [planId, setPlanId] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    Promise.all([bffJson<RestaurantEntitlementsDTO>(base), bffJson<PlanDTO[]>('admin/plans')])
      .then(([view, list]) => {
        setData(view);
        setPlans(list);
      })
      .catch(fail);
  }, [base, fail]);

  const run = async (action: () => Promise<RestaurantEntitlementsDTO>) => {
    setBusy(true);
    setError(null);
    try {
      setData(await action());
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const grant = () =>
    run(async () => {
      const result = await bffJson<RestaurantEntitlementsDTO>(base, {
        method: 'POST',
        body: JSON.stringify({
          key,
          // A date field gives a calendar day; the exception runs through the end of it in the viewer's zone.
          until: until ? new Date(`${until}T23:59:59`).toISOString() : null,
          note: note.trim() || null,
        }),
      });
      setKey('');
      setUntil('');
      setNote('');
      return result;
    });

  const assign = () =>
    run(() =>
      bffJson<RestaurantEntitlementsDTO>(`admin/restaurants/${restaurantId}/plan`, {
        method: 'PUT',
        body: JSON.stringify({
          planId,
          currentPeriodEnd: periodEnd ? new Date(`${periodEnd}T23:59:59`).toISOString() : null,
        }),
      }),
    );

  const revoke = (grantId: string) =>
    run(() => bffJson<RestaurantEntitlementsDTO>(`${base}/${grantId}`, { method: 'DELETE' }));

  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  // Offered keys: what the plan does not already carry.
  const offered = data ? PLAN_MATRIX_KEYS.filter((k) => !data.planFeatures.includes(k)) : [];

  return (
    <Card title={t('admin.entitlements.title')} aria-label={t('admin.entitlements.title')}>
      {!data ? (
        <p className="ui-text-muted">{error ?? t('common.loading')}</p>
      ) : (
        <>
          <p data-entitlement-plan={data.planCode}>
            {t('admin.entitlements.plan', { plan: planLabel(t, data.planCode, data.planName) })}
          </p>
          <form
            className="grid gap-3 md:grid-cols-3"
            aria-label={t('admin.entitlements.assign')}
            onSubmit={(event) => {
              event.preventDefault();
              if (planId) void assign();
            }}
          >
            <SelectField
              id="assign-plan"
              label={t('admin.entitlements.assignPlan')}
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              required
            >
              <option value="" />
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {planLabel(t, p.code, p.name)}
                </option>
              ))}
            </SelectField>
            <TextField
              id="assign-period-end"
              type="date"
              label={t('admin.entitlements.periodEnd')}
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
            <div className="flex items-end">
              <Button type="submit" variant="outline" tone="muted" disabled={busy || !planId}>
                {t('admin.entitlements.assign')}
              </Button>
            </div>
            <p className="ui-caption md:col-span-3">{t('admin.entitlements.assignHint')}</p>
          </form>
          {data.grants.length === 0 ? (
            <p className="ui-text-muted">{t('admin.entitlements.empty')}</p>
          ) : (
            <ul className="ui-divide">
              {data.grants.map((g) => (
                <li
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                  data-entitlement-grant={`${g.source}:${g.key}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="ui-heading">{entitlementLabel(t, g.key)}</span>
                    <Badge tone={g.source === 'EXCEPTION' ? 'success' : 'warn'}>
                      {t(`admin.entitlements.source.${g.source}`)}
                    </Badge>
                    <span className="ui-caption">
                      {g.until
                        ? t('admin.entitlements.until', { date: dateFormat.format(new Date(g.until)) })
                        : t('admin.entitlements.openEnded')}
                    </span>
                    {g.note && <span className="ui-caption">{g.note}</span>}
                  </span>
                  <Button variant="link" tone="muted" onClick={() => void revoke(g.id)} disabled={busy}>
                    {t('admin.entitlements.revoke')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="grid gap-3 md:grid-cols-3"
            aria-label={t('admin.entitlements.add')}
            onSubmit={(event) => {
              event.preventDefault();
              if (key) void grant();
            }}
          >
            <SelectField
              id="entitlement-key"
              label={t('admin.entitlements.key')}
              value={key}
              onChange={(e) => setKey(e.target.value as EntitlementKey | '')}
              required
            >
              <option value="" />
              {offered.map((k) => (
                <option key={k} value={k}>
                  {entitlementLabel(t, k)}
                </option>
              ))}
            </SelectField>
            <TextField
              id="entitlement-until"
              type="date"
              label={t('admin.entitlements.untilLabel')}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
            <TextField
              id="entitlement-note"
              label={t('admin.entitlements.note')}
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="md:col-span-3">
              <Button type="submit" disabled={busy || !key}>
                {t('admin.entitlements.add')}
              </Button>
            </div>
          </form>
          {error && (
            <p role="alert" className="ui-text-muted">
              {error}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
