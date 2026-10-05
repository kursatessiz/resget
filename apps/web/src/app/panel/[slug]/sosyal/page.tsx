import { notFound } from 'next/navigation';
import { SocialPublisher } from '@/components/panel/SocialPublisher';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** Posts for the restaurant's connected Facebook pages and Instagram accounts (docs/SOSYAL_YAYIN.md). */
export default async function SocialPublishingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership, can } = await requireMembership(slug, 'campaigns.view');
  if (!membership.features.includes('social_publishing')) notFound();
  const locale = await getLocale();
  return (
    <SocialPublisher
      restaurantId={membership.restaurantId}
      locale={locale}
      canManage={can('campaigns.manage')}
      integrationsHref={`/panel/${slug}/entegrasyon`}
    />
  );
}
