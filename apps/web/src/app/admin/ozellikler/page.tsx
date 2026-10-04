import { AdminFeatures } from '@/components/admin/AdminFeatures';
import { getLocale } from '@/lib/i18n';

export default async function AdminFeaturesPage() {
  const locale = await getLocale();
  return <AdminFeatures locale={locale} />;
}
