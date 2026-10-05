import { LiveMetaGraph } from './meta-graph';

describe('Live Meta graph', () => {
  const graph = new LiveMetaGraph('app-1', 'secret-1', 'v21.0');
  let calls: string[];

  beforeEach(() => {
    calls = [];
  });
  afterEach(() => jest.restoreAllMocks());

  const answer = (bodies: unknown[]) =>
    jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify(bodies.shift()), { status: 200 });
    });

  it('builds the consent address with the app, the state, the callback and the scopes', () => {
    const url = new URL(graph.authorizeUrl('state-1', 'https://api.example/public/oauth/meta/callback'));
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('app-1');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example/public/oauth/meta/callback');
    expect(url.searchParams.get('scope')).toContain('pages_manage_posts');
    expect(url.searchParams.get('scope')).toContain('leads_retrieval');
  });

  it('turns the code into a long-lived token', async () => {
    answer([{ access_token: 'short' }, { access_token: 'long', expires_in: 5_184_000 }]);
    const token = await graph.exchangeCode('code-1', 'https://api.example/cb');
    expect(token.token).toBe('long');
    expect(token.expiresAt).toBeInstanceOf(Date);
    expect(calls[0]).toContain('code=code-1');
    expect(calls[0]).toContain('client_secret=secret-1');
    expect(calls[1]).toContain('grant_type=fb_exchange_token');
    expect(calls[1]).toContain('fb_exchange_token=short');
  });

  it('lists pages with their Instagram accounts across result pages', async () => {
    answer([
      {
        data: [
          {
            id: 'p1',
            name: 'Lokanta',
            access_token: 'pt1',
            instagram_business_account: { id: 'ig1', username: 'lokanta' },
          },
        ],
        paging: { next: 'https://graph.facebook.com/v21.0/me/accounts?after=x' },
      },
      { data: [{ id: 'p2', name: 'Ikinci', access_token: 'pt2' }] },
    ]);
    const accounts = await graph.accounts('user-token');
    expect(accounts).toEqual([
      { kind: 'FACEBOOK_PAGE', externalId: 'p1', name: 'Lokanta', token: 'pt1' },
      { kind: 'INSTAGRAM_BUSINESS', externalId: 'ig1', name: '@lokanta', token: 'pt1' },
      { kind: 'FACEBOOK_PAGE', externalId: 'p2', name: 'Ikinci', token: 'pt2' },
    ]);
    expect(calls).toHaveLength(2);
  });

  it('fails on a Graph error', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: { code: 190 } }), { status: 400 }));
    await expect(graph.accounts('bad')).rejects.toThrow('Meta Graph 400 190');
  });

  it('subscribes a page to the leadgen webhook with a POST', async () => {
    let init: RequestInit | undefined;
    jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      calls.push(String(input));
      init = options;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    await graph.subscribeLeadgen('12345', 'page-token');
    expect(calls[0]).toBe('https://graph.facebook.com/v21.0/12345/subscribed_apps');
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toBe('subscribed_fields=leadgen&access_token=page-token');
  });

  it('reads a lead with the page token and keeps only well-formed answers', async () => {
    answer([
      {
        field_data: [{ name: 'full_name', values: ['Ayse Kaya'] }, { name: 'bad' }],
        form_id: '777',
        ad_id: '888',
      },
    ]);
    const lead = await graph.lead('4444', 'page-token');
    expect(lead).toEqual({ fields: [{ name: 'full_name', values: ['Ayse Kaya'] }], formId: '777', adId: '888' });
    expect(calls[0]).toContain('/v21.0/4444?');
    expect(calls[0]).toContain('access_token=page-token');
  });

  it('never puts a non-numeric id into a request path', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(graph.lead('../me/accounts', 'page-token')).rejects.toThrow('invalid Graph id');
    await expect(graph.subscribeLeadgen('1/../2', 'page-token')).rejects.toThrow('invalid Graph id');
    expect(spy).not.toHaveBeenCalled();
  });
});
