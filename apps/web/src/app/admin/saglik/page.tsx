import { AdminRestaurantHealth } from '@/components/admin/AdminRestaurantHealth';
import { getLocale } from '@/lib/i18n';

/** Restaurants drifting away from the platform (docs/KAYIP_RISKI.md). */
export default async function AdminRestaurantHealthPage() {
  const locale = await getLocale();
  return <AdminRestaurantHealth locale={locale} />;
}
