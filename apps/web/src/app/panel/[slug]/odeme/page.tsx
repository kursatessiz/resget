import { PaymentsSettings } from '@/components/panel/PaymentsSettings';
import { getLocale } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

export default async function PaymentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership } = await requireMembership(slug, 'payments.manage');
  const locale = await getLocale();
  // The development POS is offered only outside production; the API refuses it there anyway.
  const allowMock = process.env.NODE_ENV !== 'production';
  return <PaymentsSettings restaurantId={membership.restaurantId} locale={locale} allowMock={allowMock} />;
}
