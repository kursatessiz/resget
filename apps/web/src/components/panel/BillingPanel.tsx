'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@resget/shared';
import type {
  BillingOverviewDTO,
  CommissionInvoiceDTO,
  CommissionStatement,
  PayInvoiceResultDTO,
  SavedPaymentMethodDTO,
} from '@resget/shared';
import { Badge, Button, Card, SelectField } from '@/components/ui';
import type { UiTone } from '@/components/ui/types';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

const STATUS_TONE: Record<CommissionInvoiceDTO['status'], UiTone> = {
  DRAFT: 'muted',
  ISSUED: 'warn',
  PAID: 'success',
  OVERDUE: 'error',
  VOID: 'muted',
};

/** Commission invoices, the billing card and paying an open invoice now (docs/FATURALAMA.md). */
export function BillingPanel({
  restaurantId,
  slug,
  locale,
  canPay,
}: {
  restaurantId: string;
  slug: string;
  locale: string;
  canPay: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/billing`;
  const [data, setData] = useState<BillingOverviewDTO | null>(null);
  const [accrued, setAccrued] = useState<CommissionStatement | null>(null);
  const [cards, setCards] = useState<SavedPaymentMethodDTO[]>([]);
  const [cardId, setCardId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  const month = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  const money = (amountMinor: number, currency: string) => formatMoney({ amountMinor, currency }, locale);
  const cardLabel = (card: SavedPaymentMethodDTO) => `${card.brand} **** ${card.last4}`;

  const load = useCallback(async () => {
    const now = new Date();
    const [overview, statement, list] = await Promise.all([
      bffJson<BillingOverviewDTO>(base),
      bffJson<CommissionStatement>(
        `restaurants/${restaurantId}/payments/commission?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`,
      ),
      canPay ? bffJson<SavedPaymentMethodDTO[]>('me/payment-methods') : Promise.resolve([]),
    ]);
    setData(overview);
    setAccrued(statement);
    setCards(list);
    setCardId(
      (current) => current || overview.billingCard?.id || list.find((c) => c.isDefault)?.id || list[0]?.id || '',
    );
  }, [base, restaurantId, canPay]);

  useEffect(() => {
    load().catch(fail);
  }, [load, fail]);

  const saveCard = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setData(
        await bffJson<BillingOverviewDTO>(`${base}/card`, {
          method: 'PUT',
          body: JSON.stringify({ paymentMethodId: cardId || null }),
        }),
      );
      setNotice(t('common.saved'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const pay = async (invoice: CommissionInvoiceDTO) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await bffJson<PayInvoiceResultDTO>(`${base}/invoices/${invoice.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ returnUrl: window.location.href, ...(cardId ? { paymentMethodId: cardId } : {}) }),
      });
      if (result.status === 'REQUIRES_3DS' && result.redirectUrl) {
        setNotice(t('billing.pay.redirect'));
        window.location.assign(result.redirectUrl);
        return;
      }
      if (result.status === 'CAPTURED') setNotice(t('billing.pay.done'));
      else setError(t('billing.pay.failed', { code: result.failureCode ?? 'FAILED' }));
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('billing.title')}</h1>
        <p className="ui-text-muted">{t('billing.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="pui-alert pui-error">
          {error}
        </p>
      )}
      {notice && <p className="pui-alert pui-success">{notice}</p>}
      {data?.listingSuspendedAt && (
        <p role="status" className="pui-alert pui-error">
          {t('billing.suspended', { date: day(data.listingSuspendedAt) })}
        </p>
      )}

      <Card title={t('billing.accrued.title')}>
        {accrued && (
          <p className="ui-heading">
            {t('billing.accrued.line', {
              orders: accrued.orderCount,
              amount: money(accrued.totalMinor, accrued.currency),
            })}
          </p>
        )}
        <p className="ui-caption">{t('billing.accrued.help')}</p>
        {data && <p className="ui-caption">{t('billing.dueRule', { days: data.dueDays })}</p>}
      </Card>

      {canPay && (
        <Card title={t('billing.card.title')}>
          <p className="ui-text-muted">{t('billing.card.help')}</p>
          {cards.length === 0 ? (
            <p className="ui-caption">
              {t('billing.card.noCards')} <Link href={`/panel/${slug}/plan`}>{t('nav.subscription')}</Link>
            </p>
          ) : (
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <SelectField label={t('billing.card.title')} value={cardId} onChange={(e) => setCardId(e.target.value)}>
                <option value="">{t('billing.card.none')}</option>
                {cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {cardLabel(card)}
                  </option>
                ))}
              </SelectField>
              <Button onClick={saveCard} disabled={busy}>
                {t('billing.card.save')}
              </Button>
            </div>
          )}
          {data?.billingCard && (
            <p className="ui-caption">{t('billing.card.current', { card: cardLabel(data.billingCard) })}</p>
          )}
        </Card>
      )}

      <Card
        title={t('billing.invoices.title')}
        aside={
          data && data.openTotalMinor > 0 ? (
            <Badge tone="warn">{t('billing.open', { amount: money(data.openTotalMinor, data.currency) })}</Badge>
          ) : undefined
        }
      >
        {data && data.invoices.length === 0 && <p className="ui-text-muted">{t('billing.invoices.empty')}</p>}
        {data && data.invoices.length > 0 && (
          <ul className="flex flex-col gap-3">
            {data.invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-col gap-1 ui-rule pt-3" aria-label={month(invoice.periodStart)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="ui-heading">{month(invoice.periodStart)}</span>
                  <Badge tone={STATUS_TONE[invoice.status]}>{t(`billing.status.${invoice.status}`)}</Badge>
                </div>
                <p>
                  {t('billing.invoices.orders')}: {invoice.orderCount}. {t('billing.invoices.total')}:{' '}
                  {money(invoice.totalMinor, invoice.currency)}
                </p>
                <p className="ui-caption">
                  {t('billing.invoices.breakdown', {
                    base: money(invoice.baseMinor, invoice.currency),
                    commission: money(invoice.commissionMinor, invoice.currency),
                    vat: money(invoice.vatMinor, invoice.currency),
                  })}
                </p>
                {invoice.deductedMinor > 0 && (
                  <p className="ui-caption" data-invoice-payout-fee>
                    {t('billing.invoices.payoutFee', { amount: money(invoice.deductedMinor, invoice.currency) })}
                  </p>
                )}
                <p className="ui-caption">
                  {invoice.dueAt && `${t('billing.invoices.due')}: ${day(invoice.dueAt)}. `}
                  {invoice.paidAt && `${t('billing.invoices.paidAt', { date: day(invoice.paidAt) })}. `}
                  {invoice.fiscalRef && `${t('billing.invoices.fiscal')}: ${invoice.fiscalRef}. `}
                  {invoice.collectionAttempts > 0 &&
                    `${t('billing.invoices.attempts', { count: invoice.collectionAttempts })}. `}
                  {invoice.lastCollectionError &&
                    t('billing.invoices.lastError', { code: invoice.lastCollectionError })}
                </p>
                {canPay && (invoice.status === 'ISSUED' || invoice.status === 'OVERDUE') && (
                  <div>
                    <Button onClick={() => pay(invoice)} disabled={busy || !cardId}>
                      {t('billing.invoices.pay')}
                    </Button>
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
