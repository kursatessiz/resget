import { notFound } from 'next/navigation';
import { SocialPublisher } from '@/components/panel/SocialPublisher';
import { getLocale } from '@/lib/i18n';
import { platformAccess } from '@/lib/platform';

/** The platform's own posts to its Facebook page and Instagram account (docs/SOSYAL_YAYIN.md). */
export default async function MarketingSocialPage() {
  const access = await platformAccess();
  if (access.kind !== 'ok') return null;
  const { context } = access;
  if (!context.features.includes('social_publishing')) notFound();
  const locale = await getLocale();
  return (
    <SocialPublisher
      restaurantId={context.restaurantId}
      locale={locale}
      canManage={context.permissions.includes('platform.marketing.manage')}
      integrationsHref="/pazarlama/entegrasyonlar"
    />
  );
}
