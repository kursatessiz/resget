import type { TableDTO } from '@resget/shared';
import { PrintButton } from '@/components/panel/PrintButton';
import { LinkButton } from '@/components/ui';
import { apiFetch } from '@/lib/api-server';
import { getT } from '@/lib/i18n';
import { requireMembership } from '@/lib/panel';

/**
 * One label per active table on a printable sheet. The browser's print
 * dialog turns it into a PDF; each label image is the same SVG the download
 * button serves, fetched through the BFF with the session cookie.
 */
export default async function PrintLabelsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { membership } = await requireMembership(slug, 'tables.manage');
  const { t } = await getT();
  const res = await apiFetch(`/restaurants/${membership.restaurantId}/tables`);
  if (!res.ok) throw new Error(`tables failed with ${res.status}`);
  const tables = ((await res.json()) as TableDTO[]).filter((table) => table.isActive);
  return (
    <>
      <header className="ui-no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="ui-title">{t('tables.print.title')}</h1>
          <p className="ui-text-muted">{t('tables.print.hint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PrintButton label={t('tables.print.button')} />
          <LinkButton href={`/panel/${slug}/masalar`} variant="outline" tone="muted">
            {t('tables.print.back')}
          </LinkButton>
        </div>
      </header>
      {tables.length === 0 && <p className="ui-text-muted">{t('tables.empty')}</p>}
      <div className="ui-print-sheet">
        {tables.map((table) => (
          <figure key={table.id} className="ui-print-label">
            {/* The label is an SVG document served by the API; next/image cannot optimise it and must not. */}
            <img
              src={`/api/bff/restaurants/${membership.restaurantId}/tables/${table.id}/label.svg`}
              alt={t('tables.labelTable', { label: table.label })}
              width={600}
              height={840}
            />
          </figure>
        ))}
      </div>
    </>
  );
}
