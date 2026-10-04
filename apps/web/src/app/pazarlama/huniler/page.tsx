import { notFound } from 'next/navigation';
import { KpiBoard } from '@/components/panel/KpiBoard';
import { getLocale } from '@/lib/i18n';
import { platformAccess } from '@/lib/platform';

/** The platform funnels and KPI board (docs/HUNILER.md). */
export default async function MarketingFunnelsPage() {
  const access = await platformAccess();
  if (access.kind !== 'ok') return null;
  if (!access.context.features.includes('kpi_dashboard')) notFound();
  const locale = await getLocale();
  return <KpiBoard locale={locale} />;
}
