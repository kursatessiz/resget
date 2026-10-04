import { AdminPartnerReferrals } from '@/components/admin/AdminPartnerReferrals';
import { getLocale } from '@/lib/i18n';

/** Restaurant-to-restaurant referral settings and invitations (docs/RESTORAN_TAVSIYE.md). */
export default async function AdminPartnerReferralsPage() {
  const locale = await getLocale();
  return <AdminPartnerReferrals locale={locale} />;
}
