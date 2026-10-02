import { ThemeRoot } from '@/components/ThemeRoot';
import { LinkButton } from '@/components/ui';
import { getT } from '@/lib/i18n';

const PILLARS = ['commission', 'qr', 'saas', 'courier'] as const;

export default async function LandingPage() {
  const { t } = await getT();
  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 py-16">
        <section className="flex flex-col gap-6">
          <h1 className="ui-display">{t('landing.headline')}</h1>
          <p className="ui-lead ui-text-muted">{t('landing.subheadline')}</p>
          <div className="flex flex-wrap gap-3">
            <LinkButton href="/kayit">{t('landing.cta.restaurant')}</LinkButton>
            <LinkButton href="/giris" variant="outline" tone="muted">
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
        <footer className="ui-rule pt-6">
          <p className="ui-caption">{t('landing.footer.platform')}</p>
        </footer>
      </main>
    </ThemeRoot>
  );
}
