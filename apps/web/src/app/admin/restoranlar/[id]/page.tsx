import { notFound } from 'next/navigation';
import { UuidSchema } from '@resget/shared';
import { AdminRestaurantDetail } from '@/components/admin/AdminRestaurantDetail';
import { getLocale } from '@/lib/i18n';

export default async function AdminRestaurantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) notFound();
  const locale = await getLocale();
  return <AdminRestaurantDetail id={id} locale={locale} />;
}
