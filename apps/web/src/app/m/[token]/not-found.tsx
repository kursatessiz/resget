import { ThemeRoot } from '@/components/ThemeRoot';
import { getT } from '@/lib/i18n';

export default async function TableNotFound() {
  const { t } = await getT();
  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-16 text-center">
        <h1 className="ui-title">{t('qr.page.notFound')}</h1>
      </main>
    </ThemeRoot>
  );
}
