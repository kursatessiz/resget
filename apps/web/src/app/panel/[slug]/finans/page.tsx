import { BillingPanel } from '@/components/panel/BillingPanel';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

export default async function FinancePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'invoices.view');
  const locale = await getLocale();
  return (
    <BillingPanel restaurantId={membership.restaurantId} slug={slug} locale={locale} canPay={can('payments.manage')} />
  );
}
