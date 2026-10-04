import type { SiteRestaurantCardDTO } from '@resget/shared';
import { Card, LinkButton } from '@/components/ui';

/** Listed restaurants of a district as cards linking to their ordering pages. */
export function RestaurantCards({
  restaurants,
  openLabel,
  emptyLabel,
  label,
}: {
  restaurants: SiteRestaurantCardDTO[];
  openLabel: string;
  emptyLabel: string;
  label: string;
}) {
  if (restaurants.length === 0) return <p className="ui-text-muted">{emptyLabel}</p>;
  return (
    <ul className="grid gap-4 sm:grid-cols-2" aria-label={label}>
      {restaurants.map((r) => (
        <li key={r.slug} className="flex">
          <Card title={r.name} aria-label={r.name} className="w-full">
            <div className="flex items-center gap-3">
              {r.logoUrl && <img src={r.logoUrl} alt="" width={40} height={40} className="h-10 w-10 object-contain" />}
              <p className="ui-caption">
                {r.city} / {r.district}
              </p>
            </div>
            <LinkButton href={`/${r.slug}`}>{openLabel}</LinkButton>
          </Card>
        </li>
      ))}
    </ul>
  );
}
