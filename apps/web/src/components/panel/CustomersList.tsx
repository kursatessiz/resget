'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type { CustomerDTO, CustomerLoyaltyDTO, CustomerPageDTO, OrderSummaryDTO } from '@resget/shared';
import { Badge, Button, Card, SelectField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const SORTS = ['recent', 'orders', 'spend'] as const;

/** The restaurant's customers: search, sort, a detail with recent orders, PRO notes and tags (docs/PANEL.md). */
export function CustomersList({
  restaurantId,
  locale,
  canManage,
  canSeeOrders,
  canManageLoyalty = false,
  isPro,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
  canSeeOrders: boolean;
  /** `loyalty.manage`: shows the point adjustment on the card (docs/SADAKAT.md). */
  canManageLoyalty?: boolean;
  isPro: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/customers`;
  const [page, setPage] = useState<CustomerPageDTO | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<(typeof SORTS)[number]>('recent');
  const [open, setOpen] = useState<string | null>(null);
  const [orders, setOrders] = useState<Record<string, OrderSummaryDTO[]>>({});
  const [drafts, setDrafts] = useState<Record<string, { tags: string; note: string }>>({});
  const [adjust, setAdjust] = useState<Record<string, { points: string; memo: string }>>({});
  const [loyalty, setLoyalty] = useState<Record<string, CustomerLoyaltyDTO>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  const money = (amountMinor: number, currency: string) => formatMoney({ amountMinor, currency }, locale);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: '1', pageSize: '50', sort });
    if (query.trim()) params.set('query', query.trim());
    setPage(await bffJson<CustomerPageDTO>(`${base}?${params.toString()}`));
  }, [base, query, sort]);

  useEffect(() => {
    const handle = setTimeout(() => {
      load().catch(fail);
    }, 250);
    return () => clearTimeout(handle);
  }, [load, fail]);

  const toggle = async (customer: CustomerDTO) => {
    if (open === customer.id) {
      setOpen(null);
      return;
    }
    setOpen(customer.id);
    setDrafts((d) => ({
      ...d,
      [customer.id]: d[customer.id] ?? { tags: customer.tags.join(', '), note: customer.note ?? '' },
    }));
    if (canSeeOrders && !orders[customer.id]) {
      try {
        const list = await bffJson<OrderSummaryDTO[]>(`${base}/${customer.id}/orders`);
        setOrders((o) => ({ ...o, [customer.id]: list }));
      } catch (err) {
        fail(err);
      }
    }
  };

  const adjustPoints = async (customer: CustomerDTO) => {
    const draft = adjust[customer.id];
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await bffJson<CustomerLoyaltyDTO>(
        `restaurants/${restaurantId}/loyalty/customers/${customer.id}/adjust`,
        { method: 'POST', body: JSON.stringify({ points: Number(draft.points), memo: draft.memo.trim() }) },
      );
      setLoyalty((l) => ({ ...l, [customer.id]: result }));
      setAdjust((d) => ({ ...d, [customer.id]: { points: '', memo: '' } }));
      setNotice(t('loyalty.customer.adjusted'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const save = async (customer: CustomerDTO) => {
    const draft = drafts[customer.id];
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await bffJson<CustomerDTO>(`${base}/${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          tags: draft.tags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          note: draft.note.trim() || null,
        }),
      });
      setPage((p) => (p ? { ...p, items: p.items.map((c) => (c.id === updated.id ? updated : c)) } : p));
      setNotice(t('common.saved'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('customers.title')}</h1>
        <p className="ui-text-muted">{t('customers.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {notice && <p className="pui-alert pui-success">{notice}</p>}

      {page && (
        <div className="grid gap-3 md:grid-cols-3">
          <Card title={t('customers.summary.total')}>
            <p className="ui-title">{page.summary.total}</p>
          </Card>
          <Card title={t('customers.summary.new')}>
            <p className="ui-title">{page.summary.newLast30Days}</p>
          </Card>
          <Card title={t('customers.summary.returning')}>
            <p className="ui-title">{page.summary.returning}</p>
          </Card>
        </div>
      )}

      <Card title={t('customers.title')}>
        <div className="grid gap-3 md:grid-cols-2">
          <TextField label={t('customers.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <SelectField
            label={t('customers.sort')}
            value={sort}
            onChange={(e) => setSort(e.target.value as (typeof SORTS)[number])}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`customers.sort.${s}`)}
              </option>
            ))}
          </SelectField>
        </div>
        {page && page.items.length === 0 && <p className="ui-text-muted">{t('customers.empty')}</p>}
        {page && page.items.length > 0 && (
          <ul className="flex flex-col gap-3">
            {page.items.map((customer) => (
              <li key={customer.id} className="flex flex-col gap-2 ui-rule pt-3" aria-label={customer.fullName}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="ui-heading">{customer.fullName}</span>
                    <span className="ui-caption">{customer.phone}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {customer.tags.map((tag) => (
                      <Badge key={tag} tone="muted">
                        {tag}
                      </Badge>
                    ))}
                    <Badge tone={customer.marketingOptIn ? 'success' : 'muted'}>
                      {customer.marketingOptIn ? t('customers.optIn') : t('customers.noOptIn')}
                    </Badge>
                    <Button variant="outline" tone="muted" onClick={() => toggle(customer)}>
                      {open === customer.id ? t('customers.hide') : t('customers.details')}
                    </Button>
                  </div>
                </div>
                <p className="ui-caption">
                  {t('customers.orders', { count: customer.orderCount })}.{' '}
                  {t('customers.spend', { amount: money(customer.lifetimeGrossMinor, customer.currency) })}.{' '}
                  {customer.lastOrderAt && `${t('customers.lastOrder', { date: day(customer.lastOrderAt) })}. `}
                  {customer.firstChannel
                    ? t('customers.firstChannel', { channel: t(`orders.channel.${customer.firstChannel}`) })
                    : t('customers.prospect')}
                  . {t('loyalty.customer.points', { points: loyalty[customer.id]?.points ?? customer.loyaltyPoints })}
                  {customer.loyaltyTier && `. ${t('loyalty.tiers.label', { tier: customer.loyaltyTier })}`}
                </p>
                {open === customer.id && (
                  <div className="flex flex-col gap-3">
                    {canManage && (
                      <div className="grid gap-3 md:grid-cols-2">
                        <TextField
                          label={t('customers.tags')}
                          value={drafts[customer.id]?.tags ?? ''}
                          disabled={!isPro}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [customer.id]: { ...(d[customer.id] ?? { tags: '', note: '' }), tags: e.target.value },
                            }))
                          }
                        />
                        <TextField
                          label={t('customers.note')}
                          value={drafts[customer.id]?.note ?? ''}
                          disabled={!isPro}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [customer.id]: { ...(d[customer.id] ?? { tags: '', note: '' }), note: e.target.value },
                            }))
                          }
                        />
                        <div className="flex items-center gap-3">
                          <Button onClick={() => save(customer)} disabled={busy || !isPro}>
                            {t('customers.save')}
                          </Button>
                          {!isPro && <span className="ui-caption">{t('customers.proOnly')}</span>}
                        </div>
                      </div>
                    )}
                    {canManageLoyalty && (
                      <div className="grid gap-3 md:grid-cols-3">
                        <TextField
                          label={t('loyalty.customer.adjustPoints')}
                          type="number"
                          inputMode="numeric"
                          value={adjust[customer.id]?.points ?? ''}
                          disabled={!isPro}
                          onChange={(e) =>
                            setAdjust((d) => ({
                              ...d,
                              [customer.id]: {
                                ...(d[customer.id] ?? { points: '', memo: '' }),
                                points: e.target.value,
                              },
                            }))
                          }
                        />
                        <TextField
                          label={t('loyalty.customer.adjustMemo')}
                          value={adjust[customer.id]?.memo ?? ''}
                          maxLength={200}
                          disabled={!isPro}
                          onChange={(e) =>
                            setAdjust((d) => ({
                              ...d,
                              [customer.id]: { ...(d[customer.id] ?? { points: '', memo: '' }), memo: e.target.value },
                            }))
                          }
                        />
                        <div className="flex items-end">
                          <Button
                            variant="outline"
                            tone="muted"
                            onClick={() => adjustPoints(customer)}
                            disabled={
                              busy ||
                              !isPro ||
                              !Number.isInteger(Number(adjust[customer.id]?.points)) ||
                              Number(adjust[customer.id]?.points) === 0 ||
                              !(adjust[customer.id]?.memo ?? '').trim()
                            }
                          >
                            {t('loyalty.customer.adjust')}
                          </Button>
                        </div>
                      </div>
                    )}
                    {canSeeOrders && (
                      <div className="flex flex-col gap-1">
                        <span className="ui-heading">{t('customers.recentOrders')}</span>
                        {(orders[customer.id] ?? []).length === 0 && (
                          <span className="ui-caption">{t('customers.noOrders')}</span>
                        )}
                        {(orders[customer.id] ?? []).map((order) => (
                          <span key={order.id} className="ui-caption">
                            {t('orders.shortCode', { code: order.shortCode })}: {t(`orders.status.${order.status}`)},{' '}
                            {t(`orders.fulfillment.${order.fulfillment}`)},{' '}
                            {money(order.chargedToCustomerMinor, order.currency)}, {day(order.placedAt)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
