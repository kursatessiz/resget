'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminCreditPackageDTO, CreditChannel, PlanDTO } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

interface PackageDraft {
  code: string;
  channel: CreditChannel;
  credits: string;
  priceMinor: string;
  currency: string;
  isActive: boolean;
}

const EMPTY_PACKAGE: PackageDraft = {
  code: '',
  channel: 'SMS',
  credits: '500',
  priceMinor: '0',
  currency: 'TRY',
  isActive: true,
};

/** Plans and credit packages: prices are data the platform owner edits, never code. */
export function AdminPlans({ locale }: { locale: string }) {
  const t = useT(locale);
  const [plans, setPlans] = useState<PlanDTO[] | null>(null);
  const [packages, setPackages] = useState<AdminCreditPackageDTO[] | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { name: string; monthlyPriceMinor: string; currency: string; trialDays: string; isActive: boolean }>
  >({});
  const [pkg, setPkg] = useState<PackageDraft>(EMPTY_PACKAGE);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  const loadPlans = useCallback((list: PlanDTO[]) => {
    setPlans(list);
    setDrafts(
      Object.fromEntries(
        list.map((p) => [
          p.id,
          {
            name: p.name,
            monthlyPriceMinor: String(p.monthlyPriceMinor),
            currency: p.currency,
            trialDays: String(p.trialDays),
            isActive: p.isActive,
          },
        ]),
      ),
    );
  }, []);

  useEffect(() => {
    Promise.all([bffJson<PlanDTO[]>('admin/plans'), bffJson<AdminCreditPackageDTO[]>('admin/credit-packages')])
      .then(([p, c]) => {
        loadPlans(p);
        setPackages(c);
      })
      .catch(fail);
  }, [loadPlans, fail]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(t('common.saved'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const savePlan = (plan: PlanDTO) =>
    run(async () => {
      const d = drafts[plan.id];
      const updated = await bffJson<PlanDTO>(`admin/plans/${plan.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: d.name.trim(),
          monthlyPriceMinor: Number(d.monthlyPriceMinor),
          currency: d.currency.trim().toUpperCase(),
          trialDays: Number(d.trialDays),
          isActive: d.isActive,
        }),
      });
      loadPlans((plans ?? []).map((p) => (p.id === updated.id ? updated : p)));
    });

  const savePackage = () =>
    run(async () => {
      const saved = await bffJson<AdminCreditPackageDTO>('admin/credit-packages', {
        method: 'PUT',
        body: JSON.stringify({
          code: pkg.code.trim(),
          channel: pkg.channel,
          credits: Number(pkg.credits),
          priceMinor: Number(pkg.priceMinor),
          currency: pkg.currency.trim().toUpperCase(),
          isActive: pkg.isActive,
        }),
      });
      setPackages((list) => {
        const rest = (list ?? []).filter((p) => p.id !== saved.id);
        return [...rest, saved].sort((a, b) => a.channel.localeCompare(b.channel) || a.credits - b.credits);
      });
      setPkg(EMPTY_PACKAGE);
    });

  const count = new Intl.NumberFormat(locale);

  return (
    <>
      <h1 className="ui-title">{t('admin.nav.plans')}</h1>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}
      {notice && <p className="ui-caption">{notice}</p>}

      {(plans ?? []).map((plan) => {
        const d = drafts[plan.id];
        if (!d) return null;
        return (
          <Card
            key={plan.id}
            aria-label={t(`plans.${plan.code}.name`)}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {t(`plans.${plan.code}.name`)}
                <Badge>{plan.code}</Badge>
                <span className="ui-caption">
                  {t('admin.plans.subscriptions', { count: count.format(plan.subscriptions) })}
                </span>
              </span>
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                id={`plan-name-${plan.id}`}
                label={t('admin.plans.name')}
                value={d.name}
                onChange={(e) => setDrafts({ ...drafts, [plan.id]: { ...d, name: e.target.value } })}
              />
              <TextField
                id={`plan-price-${plan.id}`}
                label={t('admin.plans.price')}
                type="number"
                min={0}
                value={d.monthlyPriceMinor}
                onChange={(e) => setDrafts({ ...drafts, [plan.id]: { ...d, monthlyPriceMinor: e.target.value } })}
                disabled={plan.isFree}
              />
              <TextField
                id={`plan-currency-${plan.id}`}
                label={t('admin.plans.currency')}
                value={d.currency}
                maxLength={3}
                onChange={(e) => setDrafts({ ...drafts, [plan.id]: { ...d, currency: e.target.value } })}
              />
              <TextField
                id={`plan-trial-${plan.id}`}
                label={t('admin.plans.trialDays')}
                type="number"
                min={0}
                max={365}
                value={d.trialDays}
                onChange={(e) => setDrafts({ ...drafts, [plan.id]: { ...d, trialDays: e.target.value } })}
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="pui-checkbox"
                  checked={d.isActive}
                  onChange={(e) => setDrafts({ ...drafts, [plan.id]: { ...d, isActive: e.target.checked } })}
                />
                <span>{t('admin.plans.active')}</span>
              </label>
            </div>
            <div>
              <Button onClick={() => void savePlan(plan)} disabled={busy}>
                {t('common.save')}
              </Button>
            </div>
          </Card>
        );
      })}

      <Card title={t('admin.packages.title')} aria-label={t('admin.packages.title')}>
        {!packages ? (
          <p className="ui-text-muted">{t('common.loading')}</p>
        ) : packages.length === 0 ? (
          <p className="ui-text-muted">{t('admin.packages.empty')}</p>
        ) : (
          <ul className="ui-divide">
            {packages.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-package={p.code}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="ui-heading">{p.code}</span>
                  <Badge>{t(`messaging.wallet.channel.${p.channel}`)}</Badge>
                  <span>
                    {count.format(p.credits)} / {count.format(p.priceMinor)} {p.currency}
                  </span>
                  {!p.isActive && <Badge tone="muted">{t('payments.connection.status.DISABLED')}</Badge>}
                </span>
                <Button
                  variant="link"
                  tone="muted"
                  onClick={() =>
                    setPkg({
                      code: p.code,
                      channel: p.channel,
                      credits: String(p.credits),
                      priceMinor: String(p.priceMinor),
                      currency: p.currency,
                      isActive: p.isActive,
                    })
                  }
                >
                  {t('common.edit')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-3 md:grid-cols-3"
          aria-label={t('admin.packages.new')}
          onSubmit={(event) => {
            event.preventDefault();
            void savePackage();
          }}
        >
          <TextField
            id="pkg-code"
            label={t('admin.packages.code')}
            value={pkg.code}
            onChange={(e) => setPkg({ ...pkg, code: e.target.value })}
            pattern="[a-z0-9-]{3,40}"
            required
          />
          <SelectField
            id="pkg-channel"
            label={t('admin.packages.channel')}
            value={pkg.channel}
            onChange={(e) => setPkg({ ...pkg, channel: e.target.value as CreditChannel })}
          >
            <option value="SMS">{t('messaging.wallet.channel.SMS')}</option>
            <option value="WHATSAPP">{t('messaging.wallet.channel.WHATSAPP')}</option>
          </SelectField>
          <TextField
            id="pkg-credits"
            label={t('admin.packages.credits')}
            type="number"
            min={1}
            value={pkg.credits}
            onChange={(e) => setPkg({ ...pkg, credits: e.target.value })}
            required
          />
          <TextField
            id="pkg-price"
            label={t('admin.packages.price')}
            type="number"
            min={0}
            value={pkg.priceMinor}
            onChange={(e) => setPkg({ ...pkg, priceMinor: e.target.value })}
            required
          />
          <TextField
            id="pkg-currency"
            label={t('admin.packages.currency')}
            value={pkg.currency}
            maxLength={3}
            onChange={(e) => setPkg({ ...pkg, currency: e.target.value })}
            required
          />
          <label className="flex items-center gap-2 self-end">
            <input
              type="checkbox"
              className="pui-checkbox"
              checked={pkg.isActive}
              onChange={(e) => setPkg({ ...pkg, isActive: e.target.checked })}
            />
            <span>{t('admin.packages.active')}</span>
          </label>
          <div className="md:col-span-3">
            <Button type="submit" disabled={busy}>
              {t('admin.packages.save')}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
