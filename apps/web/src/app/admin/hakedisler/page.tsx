import { AdminPayoutOptions } from '@/components/admin/AdminPayoutOptions';
import { AdminPayouts } from '@/components/admin/AdminPayouts';
import { getLocale } from '@/lib/i18n';

export default async function AdminPayoutsPage() {
  const locale = await getLocale();
  return (
    <>
      <AdminPayouts locale={locale} />
      <AdminPayoutOptions locale={locale} />
    </>
  );
}
