import type { PublicSiteBlock } from '@resget/shared';
import { Card, LinkButton } from '@/components/ui';
import { RestaurantCards } from './RestaurantCards';

/**
 * An engine page's blocks (docs/SAYFA_MOTORU.md). Every value is plain text
 * rendered as text; line breaks in long text become paragraphs. The first
 * hero heading is the page's only h1.
 */
export function SiteBlocks({
  blocks,
  labels,
}: {
  blocks: PublicSiteBlock[];
  labels: { openMenu: string; noRestaurants: string };
}) {
  const firstHero = blocks.findIndex((b) => b.type === 'hero');
  return (
    <>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        switch (block.type) {
          case 'hero': {
            const Heading = index === firstHero ? 'h1' : 'h2';
            return (
              <section key={key} className="flex flex-col gap-3 py-6" data-block="hero">
                <Heading className="ui-display">{block.heading}</Heading>
                {block.subheading && <p className="ui-lead">{block.subheading}</p>}
                {block.ctaLabel && block.ctaHref && (
                  <div>
                    <LinkButton href={block.ctaHref}>{block.ctaLabel}</LinkButton>
                  </div>
                )}
              </section>
            );
          }
          case 'text':
            return (
              <section key={key} className="flex flex-col gap-3" data-block="text">
                {block.heading && <h2 className="ui-title">{block.heading}</h2>}
                <Paragraphs text={block.body} />
              </section>
            );
          case 'features':
            return (
              <section key={key} className="flex flex-col gap-4" data-block="features">
                {block.heading && <h2 className="ui-title">{block.heading}</h2>}
                <ul className="grid gap-4 sm:grid-cols-2">
                  {block.items.map((item, i) => (
                    <li key={i} className="flex flex-col gap-1">
                      <h3 className="ui-heading">{item.title}</h3>
                      <p className="ui-text-muted">{item.body}</p>
                    </li>
                  ))}
                </ul>
              </section>
            );
          case 'faq':
            return (
              <section key={key} className="flex flex-col gap-3" data-block="faq">
                {block.heading && <h2 className="ui-title">{block.heading}</h2>}
                <div className="flex flex-col ui-divide">
                  {block.items.map((item, i) => (
                    <details key={i} className="py-3">
                      <summary className="ui-heading">{item.question}</summary>
                      <div className="pt-2">
                        <Paragraphs text={item.answer} />
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            );
          case 'cta':
            return (
              <Card key={key} title={block.heading} aria-label={block.heading} data-block="cta">
                {block.body && <p className="ui-text-muted">{block.body}</p>}
                <div>
                  <LinkButton href={block.href}>{block.label}</LinkButton>
                </div>
              </Card>
            );
          case 'restaurants':
            return (
              <section key={key} className="flex flex-col gap-3" data-block="restaurants">
                {block.heading && <h2 className="ui-title">{block.heading}</h2>}
                <RestaurantCards
                  restaurants={block.restaurants}
                  openLabel={labels.openMenu}
                  emptyLabel={labels.noRestaurants}
                  label={block.heading ?? block.area.split('|')[2]}
                />
              </section>
            );
        }
      })}
    </>
  );
}

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i}>{p}</p>
        ))}
    </>
  );
}
