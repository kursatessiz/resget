import './support/meta-mock';
import type { OAuthStartDTO, SocialAccountDTO } from '@resget/shared';
import { SocialService } from '../../src/modules/social/social.service';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Integration hub (docs/ENTEGRASYON_MERKEZI.md): switch, consent round trip, single-use state, encrypted tokens. */
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
  /** The callback path and query of an authorize address (MOCK points straight back at the API). */
  const callbackPath = (authorizeUrl: string) => {
    const url = new URL(authorizeUrl);
    return `${url.pathname}${url.search}`;
  };

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

  it('connects pages through the consent round trip and keeps their tokens encrypted', async () => {
    await ctx
      .http()
      .post(`${base()}/meta/connect`)
      .set(owner())
      .send({ returnPath: 'https://evil.example/steal' })
      .expect(400);
    const { authorizeUrl } = await start();
    expect(authorizeUrl).toContain('/public/oauth/meta/callback');
    expect(new URL(authorizeUrl).searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const back = await ctx.http().get(callbackPath(authorizeUrl)).expect(302);
    expect(back.headers.location).toMatch(new RegExp(`${returnPath}\\?meta=connected$`));

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
    const replay = await ctx.http().get(callbackPath(authorizeUrl)).expect(302);
    expect(replay.headers.location).toMatch(/\/panel\?meta=error$/);
    // A reconnect updates the same rows rather than adding new ones.
    const again = await start();
    await ctx.http().get(callbackPath(again.authorizeUrl)).expect(302);
    expect(await ctx.prisma.socialAccount.count({ where: { restaurantId } })).toBe(2);
  });

  it('refuses unknown, expired and declined round trips', async () => {
    const unknown = await ctx.http().get('/public/oauth/meta/callback?code=mock-code&state=nope').expect(302);
    expect(unknown.headers.location).toMatch(/\/panel\?meta=error$/);

    const expired = await start();
    const state = new URL(expired.authorizeUrl).searchParams.get('state') ?? '';
    await ctx.prisma.oAuthState.update({ where: { state }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const late = await ctx.http().get(callbackPath(expired.authorizeUrl)).expect(302);
    expect(late.headers.location).toMatch(/\/panel\?meta=error$/);

    const declined = await start();
    const declinedState = new URL(declined.authorizeUrl).searchParams.get('state') ?? '';
    const res = await ctx
      .http()
      .get(`/public/oauth/meta/callback?error=access_denied&state=${declinedState}`)
      .expect(302);
    expect(res.headers.location).toMatch(new RegExp(`${returnPath}\\?meta=denied$`));
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
