import { notFound } from 'next/navigation';
import { UuidSchema } from '@resget/shared';
import { ThemeRoot } from '@/components/ThemeRoot';
import { getT } from '@/lib/i18n';
import { apiInternalBaseUrl } from '@/lib/server-env';

/** One-click opt-out from a campaign message (docs/KAMPANYALAR.md); opening the link is the action. */
export default async function OptOutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!UuidSchema.safeParse(token).success) notFound();
  const { t } = await getT();
  const res = await fetch(`${apiInternalBaseUrl()}/public/marketing/opt-out/${token}`, {
    method: 'POST',
    cache: 'no-store',
  });
  const result = res.ok ? ((await res.json()) as { restaurantName: string }) : null;
  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-16">
        <h1 className="ui-title">{t('campaigns.optout.title')}</h1>
        <p role="status">
          {result ? t('campaigns.optout.done', { restaurant: result.restaurantName }) : t('campaigns.optout.invalid')}
        </p>
      </main>
    </ThemeRoot>
  );
}
