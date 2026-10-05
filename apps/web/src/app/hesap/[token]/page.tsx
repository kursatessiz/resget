import { notFound } from 'next/navigation';
import { TabTokenSchema } from '@resget/shared';
import type { TabBillDTO } from '@resget/shared';
import { TabBillView } from '@/components/TabBillView';
import { ThemeRoot } from '@/components/ThemeRoot';
import { getT } from '@/lib/i18n';
import { apiInternalBaseUrl } from '@/lib/server-env';

/**
 * The table's bill (docs/ACIK_HESAP.md): the link shown after a tab order
 * and on the table's menu page. Read only, without personal data; payment
 * is made to the waiter or at the counter.
 */
export default async function TabBillPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TabTokenSchema.safeParse(token).success) notFound();
  const res = await fetch(`${apiInternalBaseUrl()}/public/tabs/${token}`, { cache: 'no-store' });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`Tab request failed with ${res.status}`);
  const bill = (await res.json()) as TabBillDTO;
  const { t, locale } = await getT();

  return (
    <ThemeRoot tenantTheme={{ themePrimary: bill.themePrimary, logoUrl: bill.logoUrl }}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-1">
          <p className="ui-caption">{bill.restaurantName}</p>
          <h1 className="ui-title">{t('tab.bill.title', { table: bill.tableLabel })}</h1>
        </header>
        <TabBillView initial={bill} locale={locale} />
        <footer className="ui-rule pt-4">
          <p className="ui-caption text-center">{t('qr.page.poweredBy')}</p>
        </footer>
      </main>
    </ThemeRoot>
  );
}
