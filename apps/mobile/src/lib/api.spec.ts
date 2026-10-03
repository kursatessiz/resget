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
});
