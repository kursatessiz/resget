import { ThemeRoot } from '@/components/ThemeRoot';
import { LinkButton } from '@/components/ui';
import { getT } from '@/lib/i18n';

export default async function PanelNotFound() {
  const { t } = await getT();
  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-16 text-center">
        <h1 className="ui-title">{t('errors.FORBIDDEN')}</h1>
        <LinkButton href="/panel" variant="outline" tone="muted">
          {t('nav.switchRestaurant')}
        </LinkButton>
      </main>
    </ThemeRoot>
  );
}
