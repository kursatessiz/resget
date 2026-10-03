'use client';

import { useCallback, useEffect, useState } from 'react';
import type { QrFunnel, RestaurantSettingsDTO, TableDTO } from '@resget/shared';
import { Badge, Button, Card, LinkButton, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/** Tables of the restaurant with their QR labels (docs/MASA_QR.md). */
export function TablesManager({
  restaurantId,
  slug,
  locale,
  canReports,
}: {
  restaurantId: string;
  slug: string;
  locale: string;
  canReports: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/tables`;
  const [tables, setTables] = useState<TableDTO[] | null>(null);
  const [branches, setBranches] = useState<RestaurantSettingsDTO['branches']>([]);
  const [funnel, setFunnel] = useState<QrFunnel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [branchId, setBranchId] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      bffJson<TableDTO[]>(base),
      bffJson<RestaurantSettingsDTO>(`restaurants/${restaurantId}`),
      canReports ? bffJson<QrFunnel>(`${base}/funnel`) : Promise.resolve(null),
    ])
      .then(([list, restaurant, stats]) => {
        if (cancelled) return;
        setTables(list);
        setBranches(restaurant.branches);
        setBranchId((current) => current || restaurant.branches[0]?.id || '');
        setFunnel(stats);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [base, restaurantId, canReports, fail]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const replace = (table: TableDTO) => setTables((list) => list && list.map((x) => (x.id === table.id ? table : x)));

  const add = () =>
    run(async () => {
      const created = await bffJson<TableDTO>(base, {
        method: 'POST',
        body: JSON.stringify({ branchId, label: label.trim() }),
      });
      setTables((list) => [...(list ?? []), created]);
      setLabel('');
    });

  const patch = (id: string, body: Record<string, unknown>) =>
    run(async () => {
      replace(await bffJson<TableDTO>(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify(body) }));
      setRenaming(null);
    });

  const regenerate = (id: string) => {
    if (!window.confirm(t('tables.confirmRegenerate'))) return;
    void run(async () => replace(await bffJson<TableDTO>(`${base}/${id}/regenerate`, { method: 'POST' })));
  };

  if (!tables) {
    return (
      <>
        <h1 className="ui-title">{t('tables.title')}</h1>
        <p className="ui-text-muted">{error ?? t('common.loading')}</p>
      </>
    );
  }

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '';
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const count = new Intl.NumberFormat(locale);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="ui-title">{t('tables.title')}</h1>
          <p className="ui-text-muted">{t('tables.intro')}</p>
        </div>
        <LinkButton href={`/panel/${slug}/masalar/yazdir`} variant="outline" tone="muted">
          {t('tables.printAll')}
        </LinkButton>
      </header>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}

      <Card>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          {branches.length > 1 && (
            <SelectField
              id="table-branch"
              label={t('tables.branch')}
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SelectField>
          )}
          <TextField
            id="table-label"
            label={t('tables.label')}
            help={t('tables.labelHelp')}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={20}
            required
          />
          <Button type="submit" disabled={busy || !branchId}>
            {t('tables.add')}
          </Button>
        </form>
      </Card>

      {funnel && (
        <Card title={t('tables.funnel.title')} aria-label={t('tables.funnel.title')}>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {(
              [
                ['sessions', funnel.sessions],
                ['viewedMenu', funnel.viewedMenu],
                ['placedOrder', funnel.placedOrder],
                ['registered', funnel.registered],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="flex flex-col">
                <dt className="ui-caption">{t(`tables.funnel.${key}`)}</dt>
                <dd className="ui-price">{count.format(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="ui-caption">
            {t('tables.funnel.placedOrder')}: {percent.format(funnel.viewToOrderRate)} / {t('tables.funnel.registered')}
            : {percent.format(funnel.viewToRegisterRate)}
          </p>
        </Card>
      )}

      <Card title={t('tables.count', { count: tables.length })} aria-label={t('tables.title')}>
        {tables.length === 0 && <p className="ui-text-muted">{t('tables.empty')}</p>}
        <ul className="ui-divide">
          {tables.map((table) => (
            <li key={table.id} className="flex flex-col gap-2 py-3" data-table-label={table.label}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {renaming?.id === table.id ? (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void patch(table.id, { label: renaming.label.trim() });
                    }}
                  >
                    <TextField
                      id={`rename-${table.id}`}
                      label={t('tables.label')}
                      value={renaming.label}
                      onChange={(e) => setRenaming({ id: table.id, label: e.target.value })}
                      maxLength={20}
                      required
                    />
                    <Button type="submit" disabled={busy}>
                      {t('common.save')}
                    </Button>
                    <Button variant="outline" tone="muted" onClick={() => setRenaming(null)}>
                      {t('common.cancel')}
                    </Button>
                  </form>
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="ui-heading">{t('tables.labelTable', { label: table.label })}</span>
                    {branches.length > 1 && <Badge>{branchName(table.branchId)}</Badge>}
                    <Badge tone={table.isActive ? 'success' : 'muted'}>
                      {table.isActive ? t('tables.active') : t('tables.inactive')}
                    </Badge>
                  </span>
                )}
                <a className="ui-caption" href={table.qrUrl} target="_blank" rel="noreferrer">
                  {t('tables.openMenu')}
                </a>
              </div>
              <div className="flex flex-wrap gap-1">
                <LinkButton href={`/api/bff/${base}/${table.id}/label.svg`} variant="outline" tone="muted" download>
                  {t('tables.downloadSvg')}
                </LinkButton>
                <LinkButton href={`/api/bff/${base}/${table.id}/qr.png`} variant="outline" tone="muted" download>
                  {t('tables.downloadPng')}
                </LinkButton>
                <Button variant="link" tone="muted" onClick={() => setRenaming({ id: table.id, label: table.label })}>
                  {t('tables.rename')}
                </Button>
                <Button
                  variant="link"
                  tone="muted"
                  disabled={busy}
                  onClick={() => patch(table.id, { isActive: !table.isActive })}
                >
                  {table.isActive ? t('tables.deactivate') : t('tables.activate')}
                </Button>
                <Button variant="link" tone="warn" disabled={busy} onClick={() => regenerate(table.id)}>
                  {t('tables.regenerate')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <p className="ui-caption">{t('tables.inactiveNote')}</p>
      </Card>
    </>
  );
}
