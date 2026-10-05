import { AdminAudit } from '@/components/admin/AdminAudit';
import { getLocale } from '@/lib/i18n';

/** The audit log, read only, with filters (docs/ONAYLAR.md). */
export default async function AdminAuditPage() {
  const locale = await getLocale();
  return <AdminAudit locale={locale} />;
}
