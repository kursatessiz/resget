import { NextRequest } from 'next/server';
import { middleware } from './middleware';

/** The BFF keeps a long-open screen signed in (docs/MIMARI.md "Oturum"), and never turns an API call into a redirect. */
const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const bffRequest = (cookie?: string) =>
  new NextRequest('http://resget.test/api/bff/restaurants/r1/orders/events', {
    headers: cookie ? { host: 'resget.test', cookie } : { host: 'resget.test' },
  });

describe('middleware on /api/bff', () => {
  it('lets an anonymous call through to the API', async () => {
    const res = await middleware(bffRequest());
    expect(res.headers.get('location')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes a lapsed access cookie and hands the new token to the proxied call', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ accessToken: 'new.access.token', refreshToken: 'new.refresh.token', expiresInSeconds: 900 }),
          {
            status: 200,
          },
        ),
    );
    const res = await middleware(bffRequest('resget_refresh=old.refresh.token'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('set-cookie')).toContain('resget_access=new.access.token');
  });

  it('clears the cookies of a refused refresh without redirecting', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 401 }));
    const res = await middleware(bffRequest('resget_refresh=old.refresh.token'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('set-cookie')).toMatch(/resget_refresh=;/);
  });
});
