import { NextRequest } from 'next/server';
import { middleware } from './middleware';

/** The custom-domain lookup on `/` (docs/VITRIN.md): what reaches the API and what the web process remembers. */
function homeRequest(host: string): NextRequest {
  return new NextRequest('http://localhost:3000/', { headers: { host } });
}

describe('middleware custom-domain lookup', () => {
  const originalFetch = global.fetch;
  const originalWebDomain = process.env.WEB_DOMAIN;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.WEB_DOMAIN = 'resget.example';
    fetchMock = jest.fn(async () => new Response('{}', { status: 404 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    if (originalWebDomain === undefined) delete process.env.WEB_DOMAIN;
    else process.env.WEB_DOMAIN = originalWebDomain;
  });

  it('asks the API once for a valid host and serves repeats from the cache', async () => {
    await middleware(homeRequest('menu.lokanta.example'));
    await middleware(homeRequest('menu.lokanta.example'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never calls the API or caches a host that is not a valid host name', async () => {
    const invalid = [
      'a'.repeat(300) + '.example',
      `${'a'.repeat(64)}.example`,
      'no_underscores.example',
      'spaces in.example',
      'single',
      '-leading.example',
      'trailing-.example',
      'xn--.example',
      '1.2.3.4',
      '.example',
      'a..example',
    ];
    for (const host of invalid) {
      await middleware(homeRequest(host));
      await middleware(homeRequest(host));
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the cache bounded: the oldest entry is evicted once the limit is passed', async () => {
    const total = 1500;
    for (let i = 0; i < total; i += 1) await middleware(homeRequest(`h${i}.lokanta.example`));
    expect(fetchMock).toHaveBeenCalledTimes(total);

    fetchMock.mockClear();
    // The first host was evicted long ago: it must be looked up again instead of living in the map forever.
    await middleware(homeRequest('h0.lokanta.example'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The most recent one is still remembered.
    await middleware(homeRequest(`h${total - 1}.lokanta.example`));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forgets an entry after its time to live', async () => {
    await middleware(homeRequest('ttl.lokanta.example'));
    jest.advanceTimersByTime(61_000);
    await middleware(homeRequest('ttl.lokanta.example'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/** The BFF keeps a long-open screen signed in (docs/MIMARI.md "Oturum"), and never turns an API call into a redirect. */
describe('middleware on /api/bff', () => {
  const originalFetch = global.fetch;
  const bffFetch = jest.fn();

  beforeEach(() => {
    bffFetch.mockReset();
    global.fetch = bffFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const bffRequest = (cookie?: string) =>
    new NextRequest('http://resget.test/api/bff/restaurants/r1/orders/events', {
      headers: cookie ? { host: 'resget.test', cookie } : { host: 'resget.test' },
    });

  it('lets an anonymous call through to the API', async () => {
    const res = await middleware(bffRequest());
    expect(res.headers.get('location')).toBeNull();
    expect(bffFetch).not.toHaveBeenCalled();
  });

  it('refreshes a lapsed access cookie and hands the new token to the proxied call', async () => {
    bffFetch.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ accessToken: 'new.access.token', refreshToken: 'new.refresh.token', expiresInSeconds: 900 }),
          { status: 200 },
        ),
    );
    const res = await middleware(bffRequest('resget_refresh=old.refresh.token'));
    expect(bffFetch).toHaveBeenCalledTimes(1);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('set-cookie')).toContain('resget_access=new.access.token');
  });

  it('clears the cookies of a refused refresh without redirecting', async () => {
    bffFetch.mockImplementation(async () => new Response('', { status: 401 }));
    const res = await middleware(bffRequest('resget_refresh=old.refresh.token'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('set-cookie')).toMatch(/resget_refresh=;/);
  });
});
