import { AdminInvoices } from '@/components/admin/AdminInvoices';
import { getLocale } from '@/lib/i18n';

export default async function AdminInvoicesPage() {
  const locale = await getLocale();
  return <AdminInvoices locale={locale} />;
}
