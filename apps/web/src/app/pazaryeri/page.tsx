import type { MarketplaceAreaDTO, MarketplaceDTO } from '@resget/shared';
import { ThemeRoot } from '@/components/ThemeRoot';
import { Badge, Button, Card, LinkButton } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { apiInternalBaseUrl } from '@/lib/server-env';

/** District marketplace (docs/VITRIN.md): listed restaurants of a launched district, no sign-in. */
export default async function MarketplacePage({ searchParams }: { searchParams: Promise<{ bolge?: string }> }) {
  const params = await searchParams;
  const { t } = await getT();
  const areasRes = await fetch(`${apiInternalBaseUrl()}/public/marketplace/areas`, { cache: 'no-store' });
  if (!areasRes.ok) throw new Error(`Marketplace areas failed with ${areasRes.status}`);
  const areas = (await areasRes.json()) as MarketplaceAreaDTO[];
  const keyOf = (a: MarketplaceAreaDTO) => `${a.countryCode}|${a.city}|${a.district}`;
  const selected = areas.find((a) => keyOf(a) === params.bolge) ?? areas[0] ?? null;
  let market: MarketplaceDTO | null = null;
  if (selected) {
    const query = new URLSearchParams({
      countryCode: selected.countryCode,
      city: selected.city,
      district: selected.district,
    });
    const res = await fetch(`${apiInternalBaseUrl()}/public/marketplace?${query.toString()}`, { cache: 'no-store' });
    if (res.ok) market = (await res.json()) as MarketplaceDTO;
  }

  return (
    <ThemeRoot tenantTheme={null}>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
        <header className="flex flex-col gap-1">
          <h1 className="ui-title">{t('shop.marketplace.title')}</h1>
          <p className="ui-text-muted">{t('shop.marketplace.intro')}</p>
        </header>
        {areas.length === 0 ? (
          <p className="ui-text-muted">{t('shop.marketplace.noAreas')}</p>
        ) : (
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="pui-field-group" htmlFor="bolge">
              <span>{t('shop.marketplace.area')}</span>
              <select id="bolge" name="bolge" className="pui-input" defaultValue={selected ? keyOf(selected) : ''}>
                {areas.map((a) => (
                  <option key={keyOf(a)} value={keyOf(a)}>
                    {a.city} / {a.district}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline" tone="muted">
              {t('shop.marketplace.show')}
            </Button>
          </form>
        )}
        {market && (
          <section className="grid gap-4 sm:grid-cols-2" aria-label={t('shop.marketplace.title')}>
            {market.restaurants.length === 0 && <p className="ui-text-muted">{t('shop.marketplace.empty')}</p>}
            {market.restaurants.map((r) => (
              <Card key={r.slug} title={r.name} aria-label={r.name}>
                <p className="ui-caption">
                  {r.city} / {r.district}
                </p>
                <div className="flex flex-wrap gap-1">
                  {r.delivery && <Badge tone="success">{t('shop.marketplace.delivery')}</Badge>}
                  {r.pickup && <Badge>{t('shop.marketplace.pickup')}</Badge>}
                </div>
                <LinkButton href={`/${r.slug}`}>{t('shop.marketplace.open')}</LinkButton>
              </Card>
            ))}
          </section>
        )}
      </main>
    </ThemeRoot>
  );
}
