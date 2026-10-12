import { imageSources } from '@resget/shared';
import type { ImageUrlPolicy } from '@resget/shared';

/**
 * The web app's Content-Security-Policy (docs/GUVENLIK.md, "Görsel bağlantıları"). It limits where pages may load
 * images from: the app itself, inline data images, the platform's upload origin, the allowlisted image hosts and the
 * map tile provider, so a restaurant cannot turn a diner's page into a beacon for a host it chose. Scripts are left
 * as they are today (Next.js inline bootstrap scripts keep working); plugins and a foreign <base> are refused.
 *
 * Built per request from the server's environment (middleware.ts), not in next.config.ts: next.config headers are
 * fixed at build time in CI, while the upload origin, the allowlist and the tile provider are deployment settings.
 */

/**
 * Where a tile URL template loads from: "https://tile.example/{z}/{x}/{y}.png" -> "https://tile.example", and a
 * leading subdomain placeholder becomes a wildcard ("https://{s}.tile.example/..." -> "https://*.tile.example").
 * A placeholder anywhere else in the host falls back to the scheme, since CSP has no pattern for it.
 */
export function tileSources(template: string): string[] {
  const match = /^(https?:)\/\/([^/?#]+)/i.exec(template.trim());
  if (!match) return [];
  const scheme = match[1].toLowerCase();
  const host = match[2].toLowerCase().replace(/^\{[^}]*\}\./, '*.');
  if (/[{}]/.test(host)) return [scheme];
  return [`${scheme}//${host}`];
}

export interface ContentSecurityPolicyInput {
  imagePolicy: ImageUrlPolicy;
  /** MAP_TILE_URL template. */
  tileUrl: string;
}

export function contentSecurityPolicy(input: ContentSecurityPolicyInput): string {
  const img = new Set(["'self'", 'data:', ...imageSources(input.imagePolicy), ...tileSources(input.tileUrl)]);
  return [`img-src ${[...img].join(' ')}`, "object-src 'none'", "base-uri 'self'"].join('; ');
}
