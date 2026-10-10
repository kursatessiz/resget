import type { TokenPairDTO } from '@resget/shared';
import { ApiClient, ApiError } from './api';

class MemoryTokens {
  tokens: TokenPairDTO | null;
  constructor(tokens: TokenPairDTO | null) {
    this.tokens = tokens;
  }
  async read(): Promise<TokenPairDTO | null> {
    return this.tokens;
  }
  async write(tokens: TokenPairDTO | null): Promise<void> {
    this.tokens = tokens;
  }
}

const pair = (access: string): TokenPairDTO => ({ accessToken: access, refreshToken: 'r1', expiresInSeconds: 900 });

describe('ApiClient', () => {
  it('sends the bearer and the restaurant header, refreshes once on 401 and replays', async () => {
    const calls: { url: string; auth: string | undefined; scope: string | undefined }[] = [];
    let accessSeen = 0;
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string>;
      calls.push({ url, auth: headers.authorization, scope: headers['x-restaurant-id'] });
      if (url.endsWith('/auth/refresh')) return Response.json(pair('a2'));
      accessSeen += 1;
      if (headers.authorization === 'Bearer a1') return new Response('', { status: 401 });
      return Response.json({ ok: true });
    }) as typeof fetch;
    const tokens = new MemoryTokens(pair('a1'));
    const client = new ApiClient({ baseUrl: 'https://api.test', tokens, fetchImpl });
    const result = await client.request<{ ok: boolean }>('restaurants/r1/courier/me/trips', { restaurantId: 'r1' });
    expect(result).toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.test/restaurants/r1/courier/me/trips',
      'https://api.test/auth/refresh',
      'https://api.test/restaurants/r1/courier/me/trips',
    ]);
    expect(calls[2].auth).toBe('Bearer a2');
    expect(calls[2].scope).toBe('r1');
    expect(accessSeen).toBe(2);
    expect(tokens.tokens?.accessToken).toBe('a2');
  });

  it('signs out when the refresh is refused and surfaces the error code', async () => {
    let signedOut = false;
    const fetchImpl = (async (input: URL | RequestInfo) => {
      if (String(input).endsWith('/auth/refresh')) return new Response('', { status: 401 });
      return new Response('', { status: 401, headers: { 'x-error-code': 'UNAUTHORIZED' } });
    }) as typeof fetch;
    const tokens = new MemoryTokens(pair('old'));
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      tokens,
      fetchImpl,
      onSignedOut: () => {
        signedOut = true;
      },
    });
    await expect(client.request('auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(signedOut).toBe(true);
    expect(tokens.tokens).toBeNull();

    const forbidden = (async () =>
      new Response('{}', { status: 403, headers: { 'x-error-code': 'FORBIDDEN' } })) as typeof fetch;
    const other = new ApiClient({
      baseUrl: 'https://api.test',
      tokens: new MemoryTokens(pair('x')),
      fetchImpl: forbidden,
    });
    await expect(other.request('x')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('keeps the session when the refresh cannot reach the API or the API fails', async () => {
    for (const refresh of [
      async () => Promise.reject(new Error('offline')),
      async () => new Response('', { status: 502 }),
    ]) {
      let signedOut = false;
      const fetchImpl = (async (input: URL | RequestInfo) => {
        if (String(input).endsWith('/auth/refresh')) return refresh();
        return new Response('', { status: 401, headers: { 'x-error-code': 'UNAUTHORIZED' } });
      }) as typeof fetch;
      const tokens = new MemoryTokens(pair('old'));
      const client = new ApiClient({
        baseUrl: 'https://api.test',
        tokens,
        fetchImpl,
        onSignedOut: () => {
          signedOut = true;
        },
      });
      await expect(client.request('auth/me')).rejects.toBeInstanceOf(ApiError);
      expect(signedOut).toBe(false);
      expect(tokens.tokens).not.toBeNull();
    }
  });

  it('ends the session at the API on sign-out and drops the tokens even without an answer', async () => {
    const calls: { url: string; body: string | undefined }[] = [];
    let reachable = true;
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body as string | undefined });
      if (!reachable) throw new Error('offline');
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const tokens = new MemoryTokens(pair('a1'));
    const client = new ApiClient({ baseUrl: 'https://api.test', tokens, fetchImpl });
    await client.logout();
    expect(calls).toEqual([{ url: 'https://api.test/auth/logout', body: JSON.stringify({ refreshToken: 'r1' }) }]);
    expect(tokens.tokens).toBeNull();

    reachable = false;
    tokens.tokens = pair('a2');
    await client.logout();
    expect(tokens.tokens).toBeNull();
  });
});
