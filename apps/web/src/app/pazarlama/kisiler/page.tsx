import { CustomersList } from '@/components/panel/CustomersList';
import { getLocale } from '@/lib/i18n';
import { platformAccess } from '@/lib/platform';

/** The platform tenant's contacts (restaurant owners and prospects), with the restaurants' customer screen. */
export default async function MarketingContactsPage() {
  const access = await platformAccess();
  if (access.kind !== 'ok') return null;
  const locale = await getLocale();
  const { context } = access;
  return (
    <CustomersList
      restaurantId={context.restaurantId}
      locale={locale}
      canManage={context.permissions.includes('platform.marketing.manage')}
      canSeeOrders={false}
      isPro
    />
  );
}
