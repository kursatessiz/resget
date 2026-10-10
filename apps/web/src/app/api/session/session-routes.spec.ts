import { NextRequest } from 'next/server';
import { POST as verify } from './verify/route';
import { GET as handoff } from './handoff/route';
import { POST as logout } from './logout/route';

/** Login CSRF (docs/GUVENLIK.md): only this site's own pages may set a session in this browser. */
const tokens = { accessToken: 'access.jwt.token', refreshToken: 'refresh.jwt.token', expiresInSeconds: 900 };
const fetchMock = jest.fn();
const okUpstream = () =>
  new Response(JSON.stringify(tokens), { status: 200, headers: { 'content-type': 'application/json' } });
const body = JSON.stringify({ phone: '+905320000002', code: '482915' });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => okUpstream());
  global.fetch = fetchMock as unknown as typeof fetch;
});

const verifyRequest = (headers: Record<string, string>, payload: string = body) =>
  new NextRequest('http://resget.test/api/session/verify', {
    method: 'POST',
    headers: { host: 'resget.test', ...headers },
    body: payload,
  });

const handoffRequest = (headers: Record<string, string>) =>
  new NextRequest(`http://resget.test/api/session/handoff?code=${'a'.repeat(43)}&next=/hesabim`, {
    headers: { host: 'resget.test', ...headers },
  });

const setsSession = (res: Response) => (res.headers.get('set-cookie') ?? '').includes('resget_access=');

describe('POST /api/session/verify', () => {
  it('signs in from its own page', async () => {
    const res = await verify(
      verifyRequest({
        'content-type': 'application/json',
        origin: 'http://resget.test',
        'sec-fetch-site': 'same-origin',
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setsSession(res)).toBe(true);
  });

  it('refuses a cross-site text/plain form that smuggles JSON', async () => {
    const res = await verify(
      verifyRequest({ 'content-type': 'text/plain', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setsSession(res)).toBe(false);
  });

  it('refuses a body that is not declared as JSON, even from its own page', async () => {
    const res = await verify(verifyRequest({ 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' }));
    expect(res.status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses JSON from another origin or another site', async () => {
    for (const headers of <Record<string, string>[]>[
      { origin: 'https://evil.example' },
      { origin: 'null' },
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site', origin: 'http://shop.resget.test' },
    ]) {
      const res = await verify(verifyRequest({ 'content-type': 'application/json', ...headers }));
      expect(res.status).toBe(403);
      expect(setsSession(res)).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/session/handoff', () => {
  it('turns the code into a session when the app opens the address itself', async () => {
    for (const site of ['none', 'same-origin']) {
      const res = await handoff(handoffRequest({ 'sec-fetch-site': site }));
      expect(res.status).toBe(303);
      expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/hesabim');
      expect(setsSession(res)).toBe(true);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never redeems a code when another site sends the browser there', async () => {
    for (const site of ['cross-site', 'same-site']) {
      const res = await handoff(handoffRequest({ 'sec-fetch-site': site }));
      expect(res.status).toBe(303);
      expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/hesabim');
      expect(setsSession(res)).toBe(false);
    }
    const foreign = await handoff(handoffRequest({ origin: 'https://evil.example' }));
    expect(setsSession(foreign)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/session/logout', () => {
  it('ends the session at the API before it clears the cookies', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    const res = await logout(
      new NextRequest('http://resget.test/api/session/logout', {
        method: 'POST',
        headers: { host: 'resget.test', cookie: 'resget_access=access.jwt.token; resget_refresh=refresh.jwt.token' },
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/auth\/logout$/);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer access.jwt.token');
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: 'refresh.jwt.token' });
    expect(res.status).toBe(303);
    expect(res.headers.get('set-cookie')).toMatch(/resget_refresh=;/);
  });

  it('still clears the cookies when the API cannot be reached', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('down');
    });
    const res = await logout(
      new NextRequest('http://resget.test/api/session/logout', {
        method: 'POST',
        headers: { host: 'resget.test', cookie: 'resget_refresh=refresh.jwt.token' },
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('set-cookie')).toMatch(/resget_access=;/);
  });
});
