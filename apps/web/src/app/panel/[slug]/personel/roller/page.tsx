import { RolesEditor } from '@/components/panel/RolesEditor';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

export default async function RolesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership } = await requireMembership(slug, 'roles.manage');
  const locale = await getLocale();
  return <RolesEditor restaurantId={membership.restaurantId} slug={slug} locale={locale} />;
}
