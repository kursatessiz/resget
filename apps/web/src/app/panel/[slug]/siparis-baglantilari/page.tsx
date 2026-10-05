import { notFound } from 'next/navigation';
import { OrderingLinks } from '@/components/panel/OrderingLinks';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/** Ordering links for Instagram, Facebook, WhatsApp, Google and TikTok (docs/SIPARIS_BAGLANTILARI.md). */
export default async function OrderingLinksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership } = await requireMembership(slug, 'reports.view');
  if (!membership.features.includes('ordering_links')) notFound();
  const locale = await getLocale();
  return <OrderingLinks restaurantId={membership.restaurantId} locale={locale} />;
}
