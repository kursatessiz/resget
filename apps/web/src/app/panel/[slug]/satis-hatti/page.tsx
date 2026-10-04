import { notFound } from 'next/navigation';
import { CrmBoard } from '@/components/panel/CrmBoard';
import { CrmTasks } from '@/components/panel/CrmTasks';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** The restaurant's pipeline of leads (catering, corporate accounts) and open tasks (docs/CRM.md). */
export default async function PipelinePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'customers.view');
  if (!membership.features.includes('contacts_crm')) notFound();
  const locale = await getLocale();
  const canManage = can('customers.manage') && membership.effectivePlan === 'PRO';
  return (
    <div className="flex flex-col gap-6">
      <CrmBoard
        restaurantId={membership.restaurantId}
        locale={locale}
        canManage={canManage}
        canExport={can('customers.contact.view')}
      />
      <CrmTasks restaurantId={membership.restaurantId} locale={locale} canManage={canManage} />
    </div>
  );
}
