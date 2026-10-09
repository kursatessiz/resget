import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Loopback, private, link-local (cloud metadata), carrier-grade NAT, multicast and reserved ranges. */
const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv6');
}

/** True when the address is not reachable on the public internet (an IPv4-mapped IPv6 address is checked as IPv4). */
export function isNonPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return NON_PUBLIC.check(mapped[1], 'ipv4');
  const family = isIP(address);
  if (family === 4) return NON_PUBLIC.check(address, 'ipv4');
  if (family === 6) return NON_PUBLIC.check(address, 'ipv6');
  return true;
}

/**
 * A URL a tenant gives the platform to call (an outbound webhook) may only reach the public internet: https, a
 * dotted host name or a public address, never `localhost`, a container name such as `postgres`, or a private
 * range. Returns the reason it is refused, or null.
 */
export function nonPublicUrlReason(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'not a URL';
  }
  if (url.protocol !== 'https:') return 'only https is allowed';
  if (url.username || url.password) return 'credentials in the URL are not allowed';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host)) return isNonPublicAddress(host) ? 'a private address is not allowed' : null;
  if (!host.includes('.') || host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) {
    return 'an internal host name is not allowed';
  }
  return null;
}

/** Resolves the host right before a call and refuses when any of its addresses is not public (DNS pointing inside). */
export async function resolvesToNonPublic(raw: string): Promise<boolean> {
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return isNonPublicAddress(host);
  const addresses = await lookup(host, { all: true, verbatim: true });
  return addresses.length === 0 || addresses.some((entry) => isNonPublicAddress(entry.address));
}
