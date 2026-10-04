import { notFound } from 'next/navigation';
import { CrmBoard } from '@/components/panel/CrmBoard';
import { getLocale } from '@/lib/i18n';
import { platformAccess } from '@/lib/platform';

/** The platform's pipeline of restaurant owners (docs/CRM.md). */
export default async function MarketingPipelinePage() {
  const access = await platformAccess();
  if (access.kind !== 'ok') return null;
  if (!access.context.features.includes('contacts_crm')) notFound();
  const locale = await getLocale();
  const { context } = access;
  return (
    <CrmBoard
      restaurantId={context.restaurantId}
      locale={locale}
      canManage={context.permissions.includes('platform.marketing.manage')}
      canExport={context.permissions.includes('platform.contacts.export')}
    />
  );
}
