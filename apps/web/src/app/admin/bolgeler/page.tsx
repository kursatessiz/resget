import { AdminAreas } from '@/components/admin/AdminAreas';
import { getLocale } from '@/lib/i18n';

export default async function AdminAreasPage() {
  const locale = await getLocale();
  return <AdminAreas locale={locale} />;
}
