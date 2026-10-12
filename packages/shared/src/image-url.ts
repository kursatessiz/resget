import { z } from 'zod';
import { HostnameSchema } from './hostname';

/**
 * Image links a restaurant stores (its logo, menu item images) are loaded by
 * every diner's browser on the storefront, the table menu and the
 * marketplace (docs/GUVENLIK.md, "Görsel bağlantıları"). A free link would
 * let a restaurant point those loads at any host and learn each diner's
 * address and visit time, so a link is accepted only when it is the
 * platform's own upload origin or https on an allowlisted host.
 *
 * Two layers:
 * - ImageUrlSchema (every client and the API): https only, no user name or
 *   password in the link; plain http only on a loopback host, so a logo the
 *   development API uploaded can be saved again.
 * - imageUrlAllowed() (the API, with the deployment's policy): the upload
 *   origin or an allowlisted host on the default https port. The web app
 *   builds its Content-Security-Policy img-src from the same policy
 *   (imageSources()), so a browser refuses what the API would refuse.
 */

export const IMAGE_URL_MAX = 500;

/**
 * The WHATWG URL parser every runtime of the package provides (Node, browsers, React Native). The package compiles
 * without DOM or Node typings, so only the fields read here are declared. Parsing with the same algorithm the browser
 * uses keeps the check and the eventual image request in agreement about scheme, credentials, host and port.
 */
interface ParsedUrl {
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly port: string;
  readonly origin: string;
}
declare const URL: new (input: string) => ParsedUrl;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https (or http on a loopback host) without credentials; anything else, or no URL at all, is refused. */
export function isSafeImageUrlShape(value: string): boolean {
  let url: ParsedUrl;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

export const ImageUrlSchema = z
  .string()
  .trim()
  .url()
  .max(IMAGE_URL_MAX)
  .refine(isSafeImageUrlShape, { message: 'https link without credentials expected' });

/** Comma-separated host names (IMAGE_HOST_ALLOWLIST), lower-cased; empty means only the upload origin. */
export const ImageHostAllowlistSchema = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  )
  .pipe(z.array(HostnameSchema));

export interface ImageUrlPolicy {
  /** Origin the platform serves its own uploads from (the API's public URL). */
  uploadOrigin: string;
  /** Further hosts a restaurant may link images from, over https on the default port. */
  allowedHosts: readonly string[];
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Whether a stored image link may be loaded by diners under the deployment's policy. */
export function imageUrlAllowed(value: string, policy: ImageUrlPolicy): boolean {
  if (!isSafeImageUrlShape(value)) return false;
  const url = new URL(value);
  if (url.origin === originOf(policy.uploadOrigin)) return true;
  return url.protocol === 'https:' && url.port === '' && policy.allowedHosts.includes(url.hostname);
}

/** The Content-Security-Policy img-src sources the policy stands for: the upload origin and each allowlisted host. */
export function imageSources(policy: ImageUrlPolicy): string[] {
  const upload = originOf(policy.uploadOrigin);
  return [...new Set([...(upload ? [upload] : []), ...policy.allowedHosts.map((host) => `https://${host}`)])];
}
