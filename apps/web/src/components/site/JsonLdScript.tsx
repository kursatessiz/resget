import { serializeJsonLd } from '@resget/shared';
import type { JsonLd } from '@resget/shared';

/** schema.org structured data; serializeJsonLd escapes `<` so tenant text can never close the tag. */
export function JsonLdScript({ data }: { data: JsonLd }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
