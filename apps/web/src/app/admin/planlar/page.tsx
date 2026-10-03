import { AdminPlans } from '@/components/admin/AdminPlans';
import { getLocale } from '@/lib/i18n';

export default async function AdminPlansPage() {
  const locale = await getLocale();
  return <AdminPlans locale={locale} />;
}
