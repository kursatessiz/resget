import { AdminRestaurants } from '@/components/admin/AdminRestaurants';
import { getLocale } from '@/lib/i18n';

export default async function AdminRestaurantsPage() {
  const locale = await getLocale();
  return <AdminRestaurants locale={locale} />;
}
