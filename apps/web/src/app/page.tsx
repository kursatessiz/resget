import type { PlatformSiteDTO } from '@resget/shared';
import { ConsentManager } from '@/components/ConsentManager';
import { PlatformLeadForm } from '@/components/PlatformLeadForm';
import { ThemeRoot } from '@/components/ThemeRoot';
import { LinkButton } from '@/components/ui';
import { consentRegime } from '@/lib/consent';
import { getT } from '@/lib/i18n';
import { apiInternalBaseUrl } from '@/lib/server-env';

const PILLARS = ['commission', 'qr', 'saas', 'courier'] as const;

/** Whether the platform's own marketing measures this site and takes leads (docs/ATIF.md); off when unknown. */
async function platformSite(): Promise<PlatformSiteDTO> {
  const res = await fetch(`${apiInternalBaseUrl()}/public/platform/site`, { cache: 'no-store' }).catch(() => null);
  return res?.ok ? ((await res.json()) as PlatformSiteDTO) : { tracking: false, leadForm: false };
}

export default async function LandingPage() {
  const { t, locale } = await getT();
  const site = await platformSite();
  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 py-16">
        <section className="flex flex-col gap-6">
          <h1 className="ui-display">{t('landing.headline')}</h1>
          <p className="ui-lead ui-text-muted">{t('landing.subheadline')}</p>
          <div className="flex flex-wrap gap-3">
            <LinkButton href="/kayit">{t('landing.cta.restaurant')}</LinkButton>
            <LinkButton href="/pazaryeri" variant="outline" tone="muted">
              {t('shop.marketplace.cta')}
            </LinkButton>
            <LinkButton href="/giris" variant="link" tone="muted">
              {t('landing.cta.signIn')}
            </LinkButton>
          </div>
        </section>
        <section className="grid gap-4 sm:grid-cols-2">
          {PILLARS.map((key) => (
            <article key={key} className="pui-card">
              <div className="pui-card-content flex flex-col gap-2">
                <h2 className="ui-heading">{t(`landing.pillar.${key}.title`)}</h2>
                <p className="ui-text-muted">{t(`landing.pillar.${key}.body`)}</p>
              </div>
            </article>
          ))}
        </section>
        {site.leadForm && <PlatformLeadForm locale={locale} />}
        <footer className="ui-rule flex flex-col gap-2 pt-6">
          <p className="ui-caption">{t('landing.footer.platform')}</p>
          {site.tracking && (
            <div>
              <ConsentManager target="platform" regime={await consentRegime()} locale={locale} />
            </div>
          )}
        </footer>
      </main>
    </ThemeRoot>
  );
}
