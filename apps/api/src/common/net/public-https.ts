import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { request } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isNonPublicAddress, nonPublicUrlReason } from './public-address';

/** Resolves every address of a host name (the system resolver, like the default connection lookup). */
export type AddressResolver = (hostname: string) => Promise<LookupAddress[]>;

const systemResolver: AddressResolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });

/**
 * A connection lookup that refuses a host name unless every address it resolves to is public. It runs when the
 * socket connects, so the address that was checked is the address that is connected to; there is no second
 * resolution between the check and the connection (DNS rebinding).
 */
export function createPublicLookup(resolver: AddressResolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    resolver(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some((entry) => isNonPublicAddress(entry.address))) {
          callback(new Error('receiver resolves to a non-public address'), '', 0);
          return;
        }
        const wanted = options.family === 4 || options.family === 6 ? options.family : 0;
        const usable = wanted === 0 ? addresses : addresses.filter((entry) => entry.family === wanted);
        const first = usable[0];
        if (!first) {
          callback(new Error('receiver has no address of the requested family'), '', 0);
        } else if (options.all) {
          callback(null, usable);
        } else {
          callback(null, first.address, first.family);
        }
      },
      (error: unknown) => callback(error instanceof Error ? error : new Error('lookup failed'), '', 0),
    );
  };
}

export interface PublicPostOptions {
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  resolver?: AddressResolver;
}

/**
 * POSTs to a public https address (outbound tenant webhooks). The host name is resolved once, at connect time,
 * through `createPublicLookup`; redirects are never followed and the response body is discarded. Resolves with the
 * response status, rejects on a refused address, a network error or the timeout.
 */
export function postToPublicHttps(rawUrl: string, options: PublicPostOptions): Promise<{ status: number }> {
  const reason = nonPublicUrlReason(rawUrl);
  if (reason) return Promise.reject(new Error(`receiver refused: ${reason}`));
  const url = new URL(rawUrl);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: 'POST',
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        headers: { ...options.headers, 'content-length': String(Buffer.byteLength(options.body)) },
        lookup: createPublicLookup(options.resolver),
        // A fresh connection per call: no pooled socket outlives the address check that opened it.
        agent: false,
        signal: AbortSignal.timeout(options.timeoutMs),
      },
      (response) => {
        response.resume();
        resolve({ status: response.statusCode ?? 0 });
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}
