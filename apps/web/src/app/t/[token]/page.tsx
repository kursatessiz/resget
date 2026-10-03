import { notFound } from 'next/navigation';
import { TrackingTokenSchema } from '@resget/shared';
import type { OrderTrackingDTO } from '@resget/shared';
import { ThemeRoot } from '@/components/ThemeRoot';
import { TrackingLive } from '@/components/TrackingLive';
import { getT } from '@/lib/i18n';
import { apiInternalBaseUrl } from '@/lib/server-env';

/**
 * The customer's live order page (docs/SIPARIS_VE_SEVK.md): the link in the
 * confirmation message. Rendered on the server from the public snapshot so
 * it works without JavaScript, then kept live by TrackingLive over
 * server-sent events through the BFF. Only this order is ever shown.
 */
export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TrackingTokenSchema.safeParse(token).success) notFound();

  const res = await fetch(`${apiInternalBaseUrl()}/public/orders/${token}`, { cache: 'no-store' });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`Tracking request failed with ${res.status}`);
  const tracking = (await res.json()) as OrderTrackingDTO;
  const { t, locale } = await getT();

  return (
    <ThemeRoot tenantTheme={{ themePrimary: tracking.restaurant.themePrimary, logoUrl: tracking.restaurant.logoUrl }}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-1">
          <p className="ui-caption">{t('tracking.title')}</p>
          <h1 className="ui-title">{t('tracking.orderFrom', { restaurant: tracking.restaurant.name })}</h1>
          <p className="ui-text-muted">{t('orders.shortCode', { code: tracking.shortCode })}</p>
        </header>
        <TrackingLive token={token} initial={tracking} locale={locale} />
        <footer className="ui-rule pt-4">
          <p className="ui-caption text-center">{t('qr.page.poweredBy')}</p>
        </footer>
      </main>
    </ThemeRoot>
  );
}
