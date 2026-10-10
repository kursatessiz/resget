import { createServer } from 'node:net';
import type { AddressInfo, Server } from 'node:net';
import type { LookupAddress } from 'node:dns';
import { createPublicLookup, postToPublicHttps } from './public-https';
import type { AddressResolver } from './public-https';

/** A documentation-range address (RFC 5737): public as far as the guard is concerned, never routed. */
const PUBLIC_ANSWER: LookupAddress = { address: '192.0.2.1', family: 4 };
const LOOPBACK_ANSWER: LookupAddress = { address: '127.0.0.1', family: 4 };

/** Runs the lookup the way a socket does and returns the callback arguments. */
function runLookup(
  resolver: AddressResolver,
  all: boolean,
): Promise<{ error: Error | null; address: string | LookupAddress[] }> {
  return new Promise((resolve) => {
    createPublicLookup(resolver)('receiver.example.test', { all }, (error, address) =>
      resolve({ error, address: address as string | LookupAddress[] }),
    );
  });
}

describe('public connection lookup', () => {
  it('hands a public answer to the connection, as a list or a single address', async () => {
    const resolver: AddressResolver = async () => [PUBLIC_ANSWER];
    expect(await runLookup(resolver, true)).toEqual({ error: null, address: [PUBLIC_ANSWER] });
    expect(await runLookup(resolver, false)).toEqual({ error: null, address: '192.0.2.1' });
  });

  it('refuses a direct private answer and an answer list that contains one', async () => {
    for (const answers of [[LOOPBACK_ANSWER], [PUBLIC_ANSWER, LOOPBACK_ANSWER], [], [{ address: '::1', family: 6 }]]) {
      const result = await runLookup(async () => answers, true);
      expect(result.error?.message).toBe('receiver resolves to a non-public address');
    }
  });

  it('passes a resolver failure on', async () => {
    const result = await runLookup(async () => Promise.reject(new Error('ENOTFOUND')), true);
    expect(result.error?.message).toBe('ENOTFOUND');
  });
});

describe('postToPublicHttps', () => {
  let loopback: Server;
  let loopbackPort = 0;
  let connections = 0;

  beforeAll(async () => {
    loopback = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => loopback.listen(0, '127.0.0.1', resolve));
    loopbackPort = (loopback.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => loopback.close(() => resolve()));
  });

  beforeEach(() => {
    connections = 0;
  });

  const post = (url: string, resolver: AddressResolver) =>
    postToPublicHttps(url, { headers: { 'content-type': 'application/json' }, body: '{}', timeoutMs: 400, resolver });

  it('resolves the name once, so a rebinding answer to a second query is never used', async () => {
    let queries = 0;
    const rebinding: AddressResolver = async () => {
      queries += 1;
      return [queries === 1 ? PUBLIC_ANSWER : LOOPBACK_ANSWER];
    };
    // The first (only) answer is the public one, which is not routed here: the call fails by timeout or network error.
    await expect(post(`https://rebind.example.test:${loopbackPort}/hook`, rebinding)).rejects.toBeDefined();
    expect(queries).toBe(1);
    expect(connections).toBe(0);
  });

  it('refuses a name that resolves to loopback without connecting', async () => {
    await expect(
      post(`https://internal.example.test:${loopbackPort}/hook`, async () => [LOOPBACK_ANSWER]),
    ).rejects.toThrow('receiver resolves to a non-public address');
    expect(connections).toBe(0);
  });

  it('refuses a private address literal and a plain http URL without resolving', async () => {
    const resolver = jest.fn<ReturnType<AddressResolver>, []>(async () => [PUBLIC_ANSWER]);
    await expect(post(`https://127.0.0.1:${loopbackPort}/hook`, resolver)).rejects.toThrow('private address');
    await expect(post(`http://hooks.example.test:${loopbackPort}/hook`, resolver)).rejects.toThrow('only https');
    expect(resolver).not.toHaveBeenCalled();
    expect(connections).toBe(0);
  });
});
