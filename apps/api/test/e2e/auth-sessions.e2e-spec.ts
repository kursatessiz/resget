import { JwtService } from '@nestjs/jwt';
import type { TokenPairDTO } from '@resget/shared';
import { SEED, OTP_TEST_CODE, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { SessionsService } from '../../src/modules/auth/sessions.service';

/** Server-side sessions (docs/GUVENLIK.md "Oturumlar"): logout, rotation with reuse detection, revocation. */
describe('Auth sessions (e2e)', () => {
  let ctx: TestContext;
  let ownerId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    ownerId = (await ctx.prisma.user.findUniqueOrThrow({ where: { phone: SEED.ownerPhone } })).id;
  });
  afterAll(async () => {
    await ctx.prisma.sessionHandoff.deleteMany({ where: { userId: ownerId } });
    await ctx.close();
  });

  const signIn = async (): Promise<TokenPairDTO> => {
    await ctx.prisma.otpCode.deleteMany({ where: { phone: SEED.ownerPhone } });
    await ctx.http().post('/auth/otp/request').send({ phone: SEED.ownerPhone }).expect(200);
    const res = await ctx
      .http()
      .post('/auth/otp/verify')
      .send({ phone: SEED.ownerPhone, code: OTP_TEST_CODE })
      .expect(200);
    return res.body as TokenPairDTO;
  };
  const refresh = (refreshToken: string) => ctx.http().post('/auth/refresh').send({ refreshToken });
  const claimsOf = (token: string): Record<string, unknown> =>
    JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;

  it('signs out: the session dies for the refresh token and the access token alike', async () => {
    const pair = await signIn();
    await ctx.http().get('/auth/me').set(bearer(pair.accessToken)).expect(200);
    await ctx.http().post('/auth/logout').set(bearer(pair.accessToken)).expect(204);
    await refresh(pair.refreshToken).expect(401);
    await ctx.http().get('/auth/me').set(bearer(pair.accessToken)).expect(401);
  });

  it('signs out with the refresh token alone, once the access token has lapsed', async () => {
    const pair = await signIn();
    await ctx.http().post('/auth/logout').send({ refreshToken: pair.refreshToken }).expect(204);
    await refresh(pair.refreshToken).expect(401);
    await ctx.http().post('/auth/logout').expect(401);
  });

  it('rotates the refresh token and ends the session when an old one is used again', async () => {
    const first = await signIn();
    const second = (await refresh(first.refreshToken).expect(200)).body as TokenPairDTO;
    const third = (await refresh(second.refreshToken).expect(200)).body as TokenPairDTO;
    expect(claimsOf(third.refreshToken).sid).toBe(claimsOf(first.refreshToken).sid);
    // The first token is two rotations old: someone else holds a copy, so the whole session ends.
    await refresh(first.refreshToken).expect(401);
    await refresh(third.refreshToken).expect(401);
    await ctx.http().get('/auth/me').set(bearer(third.accessToken)).expect(401);
  });

  it('lets two tabs refresh with the same token at the same moment', async () => {
    const pair = await signIn();
    const results = await Promise.all([refresh(pair.refreshToken), refresh(pair.refreshToken)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    for (const result of results) await refresh(result.body.refreshToken as string).expect(200);
  });

  it('gives a handoff its own session, so signing out the app keeps the browser and back', async () => {
    const app = await signIn();
    const made = await ctx.http().post('/auth/handoff').set(bearer(app.accessToken)).expect(200);
    const browser = (await ctx.http().post('/auth/handoff/redeem').send({ code: made.body.code }).expect(200))
      .body as TokenPairDTO;
    expect(claimsOf(browser.accessToken).sid).toBeTruthy();
    expect(claimsOf(browser.accessToken).sid).not.toBe(claimsOf(app.accessToken).sid);
    await ctx.http().post('/auth/logout').set(bearer(app.accessToken)).expect(204);
    await ctx.http().get('/auth/me').set(bearer(browser.accessToken)).expect(200);
    await refresh(browser.refreshToken).expect(200);
    // A signed-out session cannot mint a handoff any more.
    await ctx.http().post('/auth/handoff').set(bearer(app.accessToken)).expect(401);
  });

  it('keeps tokens issued before sessions existed working, and gives their refresh a session', async () => {
    const jwt = ctx.app.get(JwtService);
    const base = { sub: ownerId, phone: SEED.ownerPhone, isSuperAdmin: false };
    const access = await jwt.signAsync({ ...base, type: 'access' }, { expiresIn: 900 });
    const legacyRefresh = await jwt.signAsync({ ...base, type: 'refresh' }, { expiresIn: 3600 });
    await ctx.http().get('/auth/me').set(bearer(access)).expect(200);
    const renewed = (await refresh(legacyRefresh).expect(200)).body as TokenPairDTO;
    const sid = claimsOf(renewed.refreshToken).sid as string;
    expect(sid).toBeTruthy();
    expect(claimsOf(renewed.accessToken).sid).toBe(sid);
    const session = await ctx.prisma.authSession.findUniqueOrThrow({ where: { id: sid } });
    expect(session).toMatchObject({ userId: ownerId, revokedAt: null });
  });

  it('refuses a session that belongs to someone else or was never issued', async () => {
    const pair = await signIn();
    const sid = claimsOf(pair.refreshToken).sid as string;
    const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { phone: SEED.superAdminPhone } });
    const jwt = ctx.app.get(JwtService);
    const forged = await jwt.signAsync(
      { sub: admin.id, phone: admin.phone, isSuperAdmin: true, type: 'refresh', sid, gen: 0 },
      { expiresIn: 3600 },
    );
    await refresh(forged).expect(401);
    const unknown = await jwt.signAsync(
      {
        sub: ownerId,
        phone: SEED.ownerPhone,
        isSuperAdmin: false,
        type: 'access',
        sid: '00000000-0000-4000-8000-000000000000',
      },
      { expiresIn: 900 },
    );
    await ctx.http().get('/auth/me').set(bearer(unknown)).expect(401);
  });

  it('revokes every session of a user at once', async () => {
    const one = await signIn();
    const two = await signIn();
    await ctx.app.get(SessionsService).revokeAll(ownerId);
    await refresh(one.refreshToken).expect(401);
    await ctx.http().get('/auth/me').set(bearer(two.accessToken)).expect(401);
  });
});
