import { NextRequest } from 'next/server';
import { GET as callback } from './route';

/** The consent round trip ends with the session of the browser that arrives (docs/ENTEGRASYON_MERKEZI.md). */
const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const arrive = (query: string, cookie?: string) =>
  new NextRequest(`http://resget.test/api/oauth/meta/callback?${query}`, {
    headers: cookie ? { host: 'resget.test', cookie } : { host: 'resget.test' },
  });
const target = (res: Response) => {
  const url = new URL(res.headers.get('location') ?? '');
  return `${url.pathname}${url.search}`;
};
const answer = (body: unknown) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));

describe('GET /api/oauth/meta/callback', () => {
  it('passes the query on with this browser session and goes to the screen the API names', async () => {
    answer({ returnPath: '/panel/demo-lokanta/entegrasyon', result: 'connected' });
    const res = await callback(arrive('code=meta-code&state=s1', 'resget_access=access.jwt.token'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/oauth\/meta\/callback$/);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer access.jwt.token');
    expect(JSON.parse(init.body as string)).toEqual({ state: 's1', code: 'meta-code' });
    expect(res.status).toBe(303);
    expect(target(res)).toBe('/panel/demo-lokanta/entegrasyon?meta=connected');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('finishes nothing in a browser without a session', async () => {
    const res = await callback(arrive('code=meta-code&state=s1'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(target(res)).toBe('/panel?meta=error');
  });

  it('refuses a repeated or missing state, and an answer that points outside the app', async () => {
    const repeated = await callback(arrive('code=c&state=a&state=b', 'resget_access=t'));
    expect(target(repeated)).toBe('/panel?meta=error');
    const missing = await callback(arrive('code=c', 'resget_access=t'));
    expect(target(missing)).toBe('/panel?meta=error');
    expect(fetchMock).not.toHaveBeenCalled();

    answer({ returnPath: 'https://evil.example/x', result: 'owned' });
    const foreign = await callback(arrive('code=c&state=s', 'resget_access=t'));
    expect(target(foreign)).toBe('/panel?meta=error');
  });

  it('forwards a declined consent and shows the API refusal as an error', async () => {
    answer({ returnPath: '/pazarlama/entegrasyonlar', result: 'denied' });
    const declined = await callback(arrive('error=access_denied&state=s', 'resget_access=t'));
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({
      state: 's',
      error: 'access_denied',
    });
    expect(target(declined)).toBe('/pazarlama/entegrasyonlar?meta=denied');

    fetchMock.mockImplementation(async () => new Response('', { status: 401 }));
    const refused = await callback(arrive('code=c&state=s', 'resget_access=stale'));
    expect(target(refused)).toBe('/panel?meta=error');
  });
});
