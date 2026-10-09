import { createHash, randomBytes } from 'node:crypto';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { AuthService } from '../../src/modules/auth/auth.service';

/** The app hands its session to the browser with a one-time code (docs/GUVENLIK.md). */
describe('Session handoff (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let ownerId: string;
  const ghostPhone = '+905329990989';

  beforeAll(async () => {
    ctx = await createTestApp();
    ownerToken = await ctx.login(SEED.ownerPhone);
    ownerId = (await ctx.prisma.user.findUniqueOrThrow({ where: { phone: SEED.ownerPhone } })).id;
    await ctx.prisma.user.deleteMany({ where: { phone: ghostPhone } });
  });
  afterAll(async () => {
    await ctx.prisma.sessionHandoff.deleteMany({ where: { userId: ownerId } });
    await ctx.prisma.user.deleteMany({ where: { phone: ghostPhone } });
    await ctx.close();
  });

  const redeem = (code: string) => ctx.http().post('/auth/handoff/redeem').send({ code });

  it('turns a code into a session once and keeps only its hash', async () => {
    const made = await ctx.http().post('/auth/handoff').set(bearer(ownerToken)).expect(200);
    expect(made.body.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const ttl = new Date(made.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(50_000);
    expect(ttl).toBeLessThanOrEqual(60_000);
    const stored = await ctx.prisma.sessionHandoff.findMany({ where: { userId: ownerId, usedAt: null } });
    expect(stored.some((row) => row.codeHash === made.body.code)).toBe(false);
    expect(stored.some((row) => row.codeHash === createHash('sha256').update(made.body.code).digest('hex'))).toBe(true);

    const tokens = await redeem(made.body.code).expect(200);
    const me = await ctx.http().get('/auth/me').set(bearer(tokens.body.accessToken)).expect(200);
    expect(me.body.user.id).toBe(ownerId);
    // Spent.
    await redeem(made.body.code).expect(401);
  });

  it('lets one of two parallel uses win', async () => {
    const made = await ctx.http().post('/auth/handoff').set(bearer(ownerToken)).expect(200);
    const results = await Promise.all([redeem(made.body.code), redeem(made.body.code)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('refuses an expired code, a malformed one, a refresh token and no session', async () => {
    const made = await ctx.http().post('/auth/handoff').set(bearer(ownerToken)).expect(200);
    await ctx.prisma.sessionHandoff.updateMany({
      where: { codeHash: createHash('sha256').update(made.body.code).digest('hex') },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await redeem(made.body.code).expect(401);
    await redeem('not-a-code').expect(400);
    await redeem(randomBytes(32).toString('base64url')).expect(401);

    await ctx.http().post('/auth/handoff').expect(401);
    const refreshToken = await refreshTokenOfOwner();
    await ctx.http().post('/auth/handoff').set(bearer(refreshToken)).expect(401);
  });

  it('refuses a code of an account deleted after it was made', async () => {
    const ghost = await ctx.prisma.user.create({ data: { phone: ghostPhone, fullName: 'Silinen Hesap' } });
    const auth = ctx.app.get(AuthService);
    const made = await auth.createHandoff(ghost.id);
    await ctx.prisma.user.update({ where: { id: ghost.id }, data: { deletedAt: new Date() } });
    await redeem(made.code).expect(401);
  });

  it('removes rows that expired more than a day ago when a new code is made', async () => {
    const old = await ctx.prisma.sessionHandoff.create({
      data: {
        userId: ownerId,
        codeHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
        expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    });
    await ctx.http().post('/auth/handoff').set(bearer(ownerToken)).expect(200);
    expect(await ctx.prisma.sessionHandoff.findUnique({ where: { id: old.id } })).toBeNull();
  });

  async function refreshTokenOfOwner(): Promise<string> {
    const made = await ctx.app.get(AuthService).createHandoff(ownerId);
    return (await redeem(made.code).expect(200)).body.refreshToken as string;
  }
});
