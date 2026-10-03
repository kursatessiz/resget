import { AdminPayouts } from '@/components/admin/AdminPayouts';
import { getLocale } from '@/lib/i18n';

export default async function AdminPayoutsPage() {
  const locale = await getLocale();
  return <AdminPayouts locale={locale} />;
}
