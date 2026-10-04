import { AdminClaims } from '@/components/admin/AdminClaims';
import { getLocale } from '@/lib/i18n';

export default async function AdminClaimsPage() {
  const locale = await getLocale();
  return <AdminClaims locale={locale} />;
}
