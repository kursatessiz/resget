import './support/meta-mock';
import type { OAuthCompleteDTO, OAuthStartDTO, SocialAccountDTO } from '@resget/shared';
import { SocialService } from '../../src/modules/social/social.service';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/**
 * Integration hub (docs/ENTEGRASYON_MERKEZI.md): switch, consent round trip finished only by the session that
 * started it, single-use state, encrypted tokens.
 */
describe('Integration hub (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  const owner = () => bearer(ownerToken, restaurantId);
  const base = () => `/restaurants/${restaurantId}/social`;
  const returnPath = `/panel/${SEED.restaurantSlug}/entegrasyon`;
  const start = async () =>
    (await ctx.http().post(`${base()}/meta/connect`).set(owner()).send({ returnPath }).expect(200))
      .body as OAuthStartDTO;
  const stateOf = (authorizeUrl: string) => new URL(authorizeUrl).searchParams.get('state') ?? '';
  /**
   * What the web callback route does with the query MOCK sends back (code and state): post it to the API with
   * the session of the browser that arrived.
   */
  const complete = async (authorizeUrl: string, token: string = ownerToken, extra: Record<string, string> = {}) =>
    (
      await ctx
        .http()
        .post('/oauth/meta/callback')
        .set(bearer(token))
        .send({ state: stateOf(authorizeUrl), code: 'mock-code', ...extra })
        .expect(200)
    ).body as OAuthCompleteDTO;

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    restaurantId = (
      await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug }, select: { id: true } })
    ).id;
    await ctx.prisma.socialAccount.deleteMany({ where: { restaurantId } });
  });

  afterAll(async () => {
    await ctx.prisma.socialAccount.deleteMany({ where: { restaurantId } });
    await ctx.prisma.oAuthState.deleteMany({ where: { restaurantId } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'integration_hub' } });
    await ctx.prisma.auditLog.deleteMany({ where: { restaurantId, action: { startsWith: 'social.' } } });
    await ctx.close();
  });

  it('is behind its switch', async () => {
    await ctx.http().get(`${base()}/accounts`).set(owner()).expect(403).expect('x-error-code', 'FEATURE_DISABLED');
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/integration_hub`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
  });

  it('attaches nothing when a browser without the starter session completes the round trip', async () => {
    const { authorizeUrl } = await start();
    const state = stateOf(authorizeUrl);
    // Someone else's browser (no session cookie) lands on the old public callback with the starter's state.
    const back = await ctx.http().get(`/public/oauth/meta/callback?code=mock-code&state=${state}`).expect(302);
    expect(back.headers.location).toMatch(/\?meta=error$/);
    expect(await ctx.prisma.socialAccount.count({ where: { restaurantId } })).toBe(0);
    // The new completion needs a session, and it must be the starter's.
    await ctx.http().post('/oauth/meta/callback').send({ state, code: 'mock-code' }).expect(401);
    const other = await complete(authorizeUrl, adminToken);
    expect(other).toEqual({ returnPath: '/panel', result: 'error' });
    expect(await ctx.prisma.socialAccount.count({ where: { restaurantId } })).toBe(0);
    expect((await ctx.prisma.oAuthState.findUniqueOrThrow({ where: { state } })).usedAt).toBeNull();
    // The starter can still finish the round trip the others could not.
    expect((await complete(authorizeUrl)).result).toBe('connected');
    await ctx.prisma.socialAccount.deleteMany({ where: { restaurantId } });
  });

  it('connects pages through the consent round trip and keeps their tokens encrypted', async () => {
    await ctx
      .http()
      .post(`${base()}/meta/connect`)
      .set(owner())
      .send({ returnPath: 'https://evil.example/steal' })
      .expect(400);
    const { authorizeUrl } = await start();
    // Meta returns the browser to the web app, never to the API.
    expect(authorizeUrl.startsWith('http://localhost:3000/api/oauth/meta/callback?')).toBe(true);
    expect(stateOf(authorizeUrl)).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(await complete(authorizeUrl)).toEqual({ returnPath, result: 'connected' });

    const accounts = (await ctx.http().get(`${base()}/accounts`).set(owner()).expect(200)).body as SocialAccountDTO[];
    expect(accounts.map((a) => a.kind).sort()).toEqual(['FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS']);
    expect(accounts.every((a) => !a.enabled && a.status === 'ACTIVE')).toBe(true);
    expect(JSON.stringify(accounts)).not.toContain('mock-page-token');

    const stored = await ctx.prisma.socialAccount.findFirstOrThrow({
      where: { restaurantId, externalId: 'mock-page-1' },
    });
    expect(stored.encryptedToken).toMatch(/^v1\./);
    expect(ctx.app.get(SocialService).tokenOf(stored)).toBe('mock-page-token-1');

    // The same state cannot be used twice.
    expect(await complete(authorizeUrl)).toEqual({ returnPath: '/panel', result: 'error' });
    // A reconnect updates the same rows rather than adding new ones.
    const again = await start();
    expect((await complete(again.authorizeUrl)).result).toBe('connected');
    expect(await ctx.prisma.socialAccount.count({ where: { restaurantId } })).toBe(2);
  });

  it('refuses unknown, expired and declined round trips', async () => {
    const unknown = await ctx
      .http()
      .post('/oauth/meta/callback')
      .set(bearer(ownerToken))
      .send({ state: 'nope', code: 'mock-code' })
      .expect(200);
    expect(unknown.body).toEqual({ returnPath: '/panel', result: 'error' });
    await ctx.http().post('/oauth/meta/callback').set(bearer(ownerToken)).send({ code: 'mock-code' }).expect(400);

    const expired = await start();
    const state = stateOf(expired.authorizeUrl);
    await ctx.prisma.oAuthState.update({ where: { state }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await complete(expired.authorizeUrl)).toEqual({ returnPath: '/panel', result: 'error' });

    const declined = await start();
    const res = await ctx
      .http()
      .post('/oauth/meta/callback')
      .set(bearer(ownerToken))
      .send({ state: stateOf(declined.authorizeUrl), error: 'access_denied' })
      .expect(200);
    expect(res.body).toEqual({ returnPath, result: 'denied' });
  });

  it('enables and disconnects accounts, with an audit trail', async () => {
    const accounts = (await ctx.http().get(`${base()}/accounts`).set(owner()).expect(200)).body as SocialAccountDTO[];
    const page = accounts.find((a) => a.kind === 'FACEBOOK_PAGE')!;
    const enabled = (
      await ctx.http().patch(`${base()}/accounts/${page.id}`).set(owner()).send({ enabled: true }).expect(200)
    ).body as SocialAccountDTO;
    expect(enabled.enabled).toBe(true);
    await ctx
      .http()
      .patch(`${base()}/accounts/00000000-0000-4000-8000-000000000000`)
      .set(owner())
      .send({ enabled: true })
      .expect(404)
      .expect('x-error-code', 'SOCIAL_ACCOUNT_NOT_FOUND');
    await ctx.http().delete(`${base()}/accounts/${page.id}`).set(owner()).expect(204);
    expect(await ctx.prisma.socialAccount.count({ where: { restaurantId } })).toBe(1);
    const actions = (
      await ctx.prisma.auditLog.findMany({ where: { restaurantId, action: { startsWith: 'social.' } } })
    ).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['social.connect', 'social.enable', 'social.disconnect']));
  });
});
