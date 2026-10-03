import { StaffManager } from '@/components/panel/StaffManager';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

export default async function StaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'staff.manage');
  const locale = await getLocale();
  return (
    <StaffManager
      restaurantId={membership.restaurantId}
      slug={slug}
      locale={locale}
      ownMembershipId={membership.membershipId}
      canManageRoles={can('roles.manage')}
    />
  );
}
