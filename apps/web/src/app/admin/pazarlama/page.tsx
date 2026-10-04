import { AdminMarketing } from '@/components/admin/AdminMarketing';
import { getLocale } from '@/lib/i18n';

export default async function AdminMarketingPage() {
  const locale = await getLocale();
  return <AdminMarketing locale={locale} />;
}
