import { notFound } from 'next/navigation';
import { CrmTasks } from '@/components/panel/CrmTasks';
import { getLocale } from '@/lib/i18n';
import { platformAccess } from '@/lib/platform';

export default async function MarketingTasksPage() {
  const access = await platformAccess();
  if (access.kind !== 'ok') return null;
  if (!access.context.features.includes('contacts_crm')) notFound();
  const locale = await getLocale();
  return (
    <CrmTasks
      restaurantId={access.context.restaurantId}
      locale={locale}
      canManage={access.context.permissions.includes('platform.marketing.manage')}
    />
  );
}
