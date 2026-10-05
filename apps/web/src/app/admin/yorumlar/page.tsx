import { AdminReviews } from '@/components/admin/AdminReviews';
import { getLocale } from '@/lib/i18n';

export default async function AdminReviewsPage() {
  const locale = await getLocale();
  return <AdminReviews locale={locale} />;
}
