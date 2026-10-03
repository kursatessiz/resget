import type { AdminOverviewDTO } from '@resget/shared';
import { Badge, Card, LinkButton } from '@/components/ui';
import { apiFetch } from '@/lib/api-server';
import { getT } from '@/lib/i18n';

const WINDOWS = [7, 14, 30] as const;

export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const params = await searchParams;
  const days = WINDOWS.find((w) => String(w) === params.days) ?? 7;
  const { t, locale } = await getT();
  const res = await apiFetch(`/admin/overview?days=${days}`);
  if (!res.ok) throw new Error(`admin overview failed with ${res.status}`);
  const overview = (await res.json()) as AdminOverviewDTO;
  const count = new Intl.NumberFormat(locale);
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return (
    <>
      <h1 className="ui-title">{t('admin.nav.overview')}</h1>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {(
          [
            ['restaurants', overview.restaurants],
            ['listed', overview.listedRestaurants],
            ['activeTrials', overview.activeTrials],
            ['orders7d', overview.ordersLast7Days],
          ] as const
        ).map(([key, value]) => (
          <Card key={key}>
            <dt className="ui-caption">{t(`admin.overview.${key}`)}</dt>
            <dd className="ui-price">{count.format(value)}</dd>
          </Card>
        ))}
      </dl>
      <Card
        title={t('admin.density.title')}
        aria-label={t('admin.density.title')}
        aside={
          <span className="flex gap-1">
            {WINDOWS.map((w) => (
              <LinkButton
                key={w}
                href={`/admin?days=${w}`}
                variant={w === days ? 'solid' : 'outline'}
                tone={w === days ? 'theme' : 'muted'}
              >
                {w}
              </LinkButton>
            ))}
          </span>
        }
      >
        <p className="ui-caption">{t('admin.density.intro')}</p>
        {overview.density.length === 0 ? (
          <p className="ui-text-muted">{t('admin.density.empty')}</p>
        ) : (
          <table className="pui-table pui-striped">
            <thead>
              <tr>
                <th>{t('admin.density.district')}</th>
                <th>{t('admin.density.restaurants')}</th>
                <th>{t('admin.density.orders')}</th>
                <th>{t('admin.density.oard')}</th>
              </tr>
            </thead>
            <tbody>
              {overview.density.map((row) => (
                <tr key={`${row.countryCode}-${row.city}-${row.district}`}>
                  <td>
                    {row.city} / {row.district}{' '}
                    <Badge tone={row.isLaunched ? 'success' : 'muted'}>
                      {row.isLaunched ? t('admin.areas.launched') : t('admin.areas.notLaunched')}
                    </Badge>
                  </td>
                  <td>
                    {count.format(row.restaurants)} ({count.format(row.listedRestaurants)})
                  </td>
                  <td>{count.format(row.orders)}</td>
                  <td>{decimal.format(row.ordersPerRestaurantPerDay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
