import { AccountingExport } from '@/components/panel/AccountingExport';
import { BillingPanel } from '@/components/panel/BillingPanel';
import { LedgerPanel } from '@/components/panel/LedgerPanel';
import { PayoutSchedulePanel } from '@/components/panel/PayoutSchedulePanel';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** Finance: the commission invoices (OWN_POS) and the ledger with weekly payouts (PLATFORM_PSP). */
export default async function FinancePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'invoices.view');
  const locale = await getLocale();
  return (
    <div className="flex flex-col gap-6">
      <BillingPanel
        restaurantId={membership.restaurantId}
        slug={slug}
        locale={locale}
        canPay={can('payments.manage')}
      />
      {can('finance.view') && membership.features.includes('payout_schedules') && (
        <PayoutSchedulePanel
          restaurantId={membership.restaurantId}
          locale={locale}
          canManage={can('payments.manage')}
        />
      )}
      {can('finance.view') && <LedgerPanel restaurantId={membership.restaurantId} locale={locale} />}
      {can('finance.view') && membership.features.includes('accounting_export') && (
        <AccountingExport restaurantId={membership.restaurantId} locale={locale} />
      )}
    </div>
  );
}
