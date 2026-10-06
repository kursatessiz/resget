'use client';

import { useEffect, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type { TabBillDTO, TabPaymentStartedDTO } from '@resget/shared';
import { Badge, Button, Card } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';
import { TabSplit } from './TabSplit';

const REFRESH_MS = 20_000;

/** The bill as the table sees it (docs/ACIK_HESAP.md): items, orders, totals and the split calculator. */
export function TabBillView({ initial, locale }: { initial: TabBillDTO; locale: string }) {
  const t = useT(locale);
  const [bill, setBill] = useState(initial);

  // The bill follows new orders and collections while it is open.
  useEffect(() => {
    if (bill.status !== 'OPEN') return;
    const timer = setInterval(() => {
      bffJson<TabBillDTO>(`public/tabs/${bill.token}`)
        .then(setBill)
        .catch(() => undefined);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [bill.status, bill.token]);

  const money = (minor: number) => formatMoney({ amountMinor: minor, currency: bill.currency }, locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** A share paid by card on the restaurant's own POS; the bill follows once the POS confirms. */
  const payOnline = async (amountMinor: number) => {
    setBusy(true);
    setError(null);
    try {
      const started = await bffJson<TabPaymentStartedDTO>(`public/tabs/${bill.token}/pay`, {
        method: 'POST',
        body: JSON.stringify({ amountMinor, returnUrl: `${window.location.origin}/hesap/${bill.token}` }),
      });
      window.location.assign(started.session.redirectUrl);
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {bill.status === 'CLOSED' ? (
        <p role="status" className="ui-heading" data-tab-closed>
          {t('tab.bill.closed')}
        </p>
      ) : (
        <p className="ui-text-muted">{t('tab.bill.intro')}</p>
      )}
      <Card title={t('tab.bill.lines')} aria-label={t('tab.bill.lines')}>
        {bill.lines.length === 0 ? (
          <p className="ui-text-muted">{t('tab.bill.empty')}</p>
        ) : (
          <ul className="ui-divide">
            {bill.lines.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-2 py-2" data-bill-line>
                <span className="flex flex-col">
                  <span>
                    {line.quantity} x {line.name}
                  </span>
                  {line.modifiers.length > 0 && <span className="ui-caption">{line.modifiers.join(', ')}</span>}
                </span>
                <span>{money(line.totalMinor)}</span>
              </li>
            ))}
          </ul>
        )}
        <ul className="flex flex-col gap-1">
          {bill.discountMinor > 0 && (
            <li className="flex justify-between gap-2">
              <span className="ui-caption">{t('tab.bill.discount')}</span>
              <span>-{money(bill.discountMinor)}</span>
            </li>
          )}
          <li className="flex justify-between gap-2">
            <span className="ui-caption">{t('tab.bill.total')}</span>
            <span data-bill-total>{money(bill.totalMinor)}</span>
          </li>
          <li className="flex justify-between gap-2">
            <span className="ui-caption">{t('tab.bill.paid')}</span>
            <span data-bill-paid>{money(bill.paidMinor)}</span>
          </li>
          <li className="flex justify-between gap-2">
            <span className="ui-heading">{t('tab.bill.due')}</span>
            <span className="ui-price" data-bill-due>
              {money(bill.dueMinor)}
            </span>
          </li>
        </ul>
      </Card>
      <Card title={t('tab.bill.orders')} aria-label={t('tab.bill.orders')}>
        <ul className="ui-divide">
          {bill.orders.map((order) => (
            <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{t('tab.bill.order', { code: order.shortCode })}</span>
              <Badge tone="muted">{t(`orders.status.${order.status}`)}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      {bill.status === 'OPEN' && bill.dueMinor > 0 && bill.payOnline && (
        <Card title={t('tab.pay.title')} aria-label={t('tab.pay.title')}>
          <div className="flex flex-col gap-2">
            <p className="ui-caption">{t('tab.pay.hint')}</p>
            {error && <p role="alert">{error}</p>}
            <div>
              <Button disabled={busy} onClick={() => void payOnline(bill.dueMinor)}>
                {t('tab.pay.all', { amount: money(bill.dueMinor) })}
              </Button>
            </div>
          </div>
        </Card>
      )}
      {bill.status === 'OPEN' && bill.dueMinor > 0 && (
        <TabSplit
          bill={bill}
          locale={locale}
          {...(bill.payOnline
            ? { onUseShare: (amount: number) => void payOnline(amount), useShareLabel: t('tab.pay.useShare') }
            : {})}
        />
      )}
    </div>
  );
}
