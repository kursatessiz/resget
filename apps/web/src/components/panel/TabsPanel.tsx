'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type { CollectTabPaymentInput, TabBillDTO, TabSummaryDTO } from '@resget/shared';
import { Button, Card, SelectField, TextField } from '@/components/ui';
import { TabSplit } from '@/components/TabSplit';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

/**
 * Open tabs (docs/ACIK_HESAP.md): every table with a running bill, and for
 * the chosen one its items, the split calculator and the collection form.
 * A share picked in the calculator fills the amount to collect.
 */
export function TabsPanel({
  restaurantId,
  locale,
  canCollect,
}: {
  restaurantId: string;
  locale: string;
  canCollect: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/tabs`;
  const [tabs, setTabs] = useState<TabSummaryDTO[] | null>(null);
  const [bill, setBill] = useState<TabBillDTO | null>(null);
  const [method, setMethod] = useState('CASH_ON_DELIVERY');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );
  const loadList = useCallback(() => bffJson<TabSummaryDTO[]>(base).then(setTabs).catch(fail), [base, fail]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const open = (tabId: string) => {
    setError(null);
    setNotice(null);
    bffJson<TabBillDTO>(`${base}/${tabId}`)
      .then((b) => {
        setBill(b);
        setAmount(String(b.dueMinor));
        setMethod(b.collect?.cash ? 'CASH_ON_DELIVERY' : b.collect?.card ? 'CARD_ON_DELIVERY' : 'CASH_ON_DELIVERY');
      })
      .catch(fail);
  };

  const run = async (action: () => Promise<TabBillDTO>, done: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await action();
      setBill(next);
      setAmount(String(next.dueMinor));
      setReference('');
      setNotice(done);
      void loadList();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const collect = () => {
    if (!bill) return;
    const [kind, providerCode] = method.split(':');
    const body: CollectTabPaymentInput = {
      method: kind as CollectTabPaymentInput['method'],
      amountMinor: Number(amount),
      ...(providerCode ? { providerCode } : {}),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
    } as CollectTabPaymentInput;
    void run(
      () => bffJson<TabBillDTO>(`${base}/${bill.id}/collect`, { method: 'POST', body: JSON.stringify(body) }),
      t('tab.panel.collected'),
    );
  };

  const close = () => {
    if (!bill) return;
    void run(() => bffJson<TabBillDTO>(`${base}/${bill.id}/close`, { method: 'POST' }), t('tab.panel.closed'));
  };

  const money = (minor: number, currency: string) => formatMoney({ amountMinor: minor, currency }, locale);

  if (bill) {
    const m = (minor: number) => money(minor, bill.currency);
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="ui-title">{t('tab.panel.table', { table: bill.tableLabel })}</h1>
          <Button variant="link" tone="muted" onClick={() => setBill(null)}>
            {t('tab.panel.back')}
          </Button>
        </header>
        {error && (
          <p role="alert" className="ui-text-muted">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="ui-caption">
            {notice}
          </p>
        )}
        <Card title={t('tab.bill.lines')} aria-label={t('tab.bill.lines')}>
          <ul className="ui-divide">
            {bill.lines.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-2 py-2">
                <span className="flex flex-col">
                  <span>
                    {line.quantity} x {line.name}
                  </span>
                  <span className="ui-caption">
                    {t('tab.bill.order', { code: line.orderShortCode })}
                    {line.modifiers.length > 0 ? ` / ${line.modifiers.join(', ')}` : ''}
                  </span>
                </span>
                <span>{m(line.totalMinor)}</span>
              </li>
            ))}
          </ul>
          <p data-panel-bill-summary>
            {t('tab.bill.total')}: {m(bill.totalMinor)} / {t('tab.bill.paid')}: {m(bill.paidMinor)} /{' '}
            <span className="ui-heading">
              {t('tab.bill.due')}: {m(bill.dueMinor)}
            </span>
          </p>
        </Card>

        {bill.status === 'OPEN' && bill.dueMinor > 0 && (
          <TabSplit
            bill={bill}
            locale={locale}
            onUseShare={canCollect ? (share) => setAmount(String(share)) : undefined}
          />
        )}

        {canCollect && bill.status === 'OPEN' && (
          <Card title={t('tab.panel.collect.title')} aria-label={t('tab.panel.collect.title')}>
            {bill.dueMinor > 0 && (
              <form
                className="grid gap-3 md:grid-cols-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  collect();
                }}
              >
                <TextField
                  id="tab-collect-amount"
                  type="number"
                  min={1}
                  max={bill.dueMinor}
                  label={t('tab.panel.collect.amount')}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
                <SelectField
                  id="tab-collect-method"
                  label={t('tab.panel.collect.method')}
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {bill.collect?.cash && (
                    <option value="CASH_ON_DELIVERY">{t('payments.method.CASH_ON_DELIVERY')}</option>
                  )}
                  {bill.collect?.card && (
                    <option value="CARD_ON_DELIVERY">{t('payments.method.CARD_ON_DELIVERY')}</option>
                  )}
                  {bill.collect?.mealCards.map((card) => (
                    <option key={card.providerCode} value={`MEAL_CARD:${card.providerCode}`}>
                      {t('shop.payment.mealCardAtDoor', { card: card.name })}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  id="tab-collect-reference"
                  label={t('tab.panel.collect.reference')}
                  value={reference}
                  maxLength={80}
                  onChange={(e) => setReference(e.target.value)}
                />
                <div className="flex flex-wrap gap-2 md:col-span-3">
                  <Button type="submit" disabled={busy || !(Number(amount) > 0)}>
                    {t('tab.panel.collect.submit')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    tone="muted"
                    disabled={busy}
                    onClick={() => setAmount(String(bill.dueMinor))}
                  >
                    {t('tab.panel.collect.all')}
                  </Button>
                </div>
              </form>
            )}
            {bill.dueMinor === 0 && (
              <div>
                <Button onClick={close} disabled={busy}>
                  {t('tab.panel.close')}
                </Button>
              </div>
            )}
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('tab.panel.title')}</h1>
        <p className="ui-text-muted">{t('tab.panel.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="ui-caption">
          {notice}
        </p>
      )}
      {!tabs ? (
        <p className="ui-text-muted">{t('common.loading')}</p>
      ) : tabs.length === 0 ? (
        <p className="ui-text-muted">{t('tab.panel.empty')}</p>
      ) : (
        <ul className="ui-divide">
          {tabs.map((tab) => (
            <li
              key={tab.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
              data-tab-row={tab.tableLabel}
            >
              <span className="flex flex-col">
                <span className="ui-heading">{t('tab.panel.table', { table: tab.tableLabel })}</span>
                <span className="ui-caption">
                  {t('tab.panel.summary', {
                    orders: tab.orderCount,
                    total: money(tab.totalMinor, tab.currency),
                    due: money(tab.dueMinor, tab.currency),
                  })}
                </span>
              </span>
              <Button variant="outline" tone="muted" onClick={() => open(tab.id)}>
                {t('tab.panel.open')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
