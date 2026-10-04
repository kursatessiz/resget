import { DeliveryZoneEditor } from '@/components/panel/DeliveryZoneEditor';
import { OpeningHoursEditor } from '@/components/panel/OpeningHoursEditor';
import { SettingsForm } from '@/components/panel/SettingsForm';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'restaurant.settings.view');
  const locale = await getLocale();
  return (
    <div className="flex flex-col gap-6">
      <SettingsForm
        restaurantId={membership.restaurantId}
        locale={locale}
        canManage={can('restaurant.settings.manage')}
      />
      {membership.features.includes('delivery_zones') && (
        <DeliveryZoneEditor
          restaurantId={membership.restaurantId}
          locale={locale}
          canManage={can('restaurant.settings.manage')}
        />
      )}
      <OpeningHoursEditor
        restaurantId={membership.restaurantId}
        locale={locale}
        canManage={can('restaurant.settings.manage')}
      />
    </div>
  );
}
