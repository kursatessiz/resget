import { ERROR_CODE_HEADER } from '@resget/shared';
import { SEED, OTP_TEST_CODE, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

describe('Auth (e2e)', () => {
  let ctx: TestContext;
  const guestPhone = '+905329990001';

  beforeAll(async () => {
    ctx = await createTestApp();
    // Leftovers of an earlier run against the same database (OTP rows do not cascade with the user).
    await ctx.prisma.otpCode.deleteMany({ where: { phone: guestPhone } });
    await ctx.prisma.user.deleteMany({ where: { phone: guestPhone } });
  });
  afterAll(async () => {
    await ctx.prisma.otpCode.deleteMany({ where: { phone: guestPhone } });
    await ctx.prisma.user.deleteMany({ where: { phone: guestPhone } });
    await ctx.close();
  });

  it('rejects an invalid phone with the VALIDATION code', async () => {
    const res = await ctx.http().post('/auth/otp/request').send({ phone: 'abc' }).expect(400);
    expect(res.headers[ERROR_CODE_HEADER]).toBe('VALIDATION');
    expect(res.body.code).toBe('VALIDATION');
  });

  it('refuses a wrong code and counts the attempt', async () => {
    await ctx.prisma.otpCode.deleteMany({ where: { phone: SEED.ownerPhone } });
    await ctx.http().post('/auth/otp/request').send({ phone: SEED.ownerPhone }).expect(200);
    const res = await ctx.http().post('/auth/otp/verify').send({ phone: SEED.ownerPhone, code: '000000' }).expect(401);
    expect(res.headers[ERROR_CODE_HEADER]).toBe('UNAUTHORIZED');
    const otp = await ctx.prisma.otpCode.findFirst({
      where: { phone: SEED.ownerPhone },
      orderBy: { createdAt: 'desc' },
    });
    expect(otp?.attempts).toBe(1);
  });

  it('registers a guest from a table QR: the REGISTERED funnel step and the customer record', async () => {
    const session = `e2e-register-${Date.now()}`;
    await ctx.prisma.otpCode.deleteMany({ where: { phone: guestPhone } });
    await ctx.http().post('/auth/otp/request').send({ phone: guestPhone }).expect(200);
    const res = await ctx
      .http()
      .post('/auth/otp/verify')
      .send({
        phone: guestPhone,
        code: OTP_TEST_CODE,
        fullName: 'E2E Misafir',
        qrToken: SEED.tableToken,
        qrSessionId: session,
      })
      .expect(200);
    expect(res.body.accessToken).toBeTruthy();
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { phone: guestPhone } });
    expect(user.fullName).toBe('E2E Misafir');
    const event = await ctx.prisma.qrScanEvent.findFirst({ where: { sessionId: session } });
    expect(event?.outcome).toBe('REGISTERED');
    expect(event?.userId).toBe(user.id);
    const customer = await ctx.prisma.restaurantCustomer.findFirst({ where: { userId: user.id } });
    expect(customer?.firstChannel).toBe('TABLE_QR');
    await ctx.prisma.qrScanEvent.deleteMany({ where: { sessionId: session } });
  });

  it('signs the owner in and lists the membership with owner permissions and the PRO trial', async () => {
    const token = await ctx.login(SEED.ownerPhone);
    const me = await ctx.http().get('/auth/me').set(bearer(token)).expect(200);
    expect(me.body.user.phone).toBe(SEED.ownerPhone);
    expect(me.body.memberships).toHaveLength(1);
    const m = me.body.memberships[0];
    expect(m.restaurantSlug).toBe(SEED.restaurantSlug);
    expect(m.isOwner).toBe(true);
    expect(m.permissions).toContain('orders.manage');
    expect(m.effectivePlan).toBe('PRO');
  });

  it('refreshes a token pair and rejects an access token used as refresh', async () => {
    await ctx.prisma.otpCode.deleteMany({ where: { phone: SEED.ownerPhone } });
    await ctx.http().post('/auth/otp/request').send({ phone: SEED.ownerPhone }).expect(200);
    const pair = await ctx
      .http()
      .post('/auth/otp/verify')
      .send({ phone: SEED.ownerPhone, code: OTP_TEST_CODE })
      .expect(200);
    const refreshed = await ctx.http().post('/auth/refresh').send({ refreshToken: pair.body.refreshToken }).expect(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    await ctx.http().post('/auth/refresh').send({ refreshToken: pair.body.accessToken }).expect(401);
  });

  it('creates a new user for an unknown phone (a guest registering from a table QR)', async () => {
    const phone = guestPhone;
    await ctx.http().post('/auth/otp/request').send({ phone }).expect(200);
    const res = await ctx
      .http()
      .post('/auth/otp/verify')
      .send({ phone, code: OTP_TEST_CODE, fullName: 'E2E Misafir' })
      .expect(200);
    const me = await ctx.http().get('/auth/me').set(bearer(res.body.accessToken)).expect(200);
    expect(me.body.user.fullName).toBe('E2E Misafir');
    expect(me.body.memberships).toEqual([]);
  });

  it('rate limits code requests per phone', async () => {
    const phone = guestPhone;
    await ctx.prisma.otpCode.deleteMany({ where: { phone } });
    for (let i = 0; i < 3; i += 1) await ctx.http().post('/auth/otp/request').send({ phone }).expect(200);
    const res = await ctx.http().post('/auth/otp/request').send({ phone }).expect(403);
    expect(res.body.code).toBe('RATE_LIMITED');
  });

  it('counts parallel wrong guesses against the five attempts and consumes a code once', async () => {
    const phone = guestPhone;
    await ctx.prisma.otpCode.deleteMany({ where: { phone } });
    await ctx.http().post('/auth/otp/request').send({ phone }).expect(200);
    const guesses = await Promise.all(
      Array.from({ length: 12 }, () => ctx.http().post('/auth/otp/verify').send({ phone, code: '000000' })),
    );
    expect(guesses.every((r) => r.status === 401 || r.status === 403)).toBe(true);
    const row = await ctx.prisma.otpCode.findFirstOrThrow({ where: { phone }, orderBy: { createdAt: 'desc' } });
    expect(row.attempts).toBe(5);
    // The right code no longer helps once the attempts are spent.
    const locked = await ctx.http().post('/auth/otp/verify').send({ phone, code: OTP_TEST_CODE }).expect(403);
    expect(locked.body.code).toBe('RATE_LIMITED');

    await ctx.prisma.otpCode.deleteMany({ where: { phone } });
    await ctx.http().post('/auth/otp/request').send({ phone }).expect(200);
    const twice = await Promise.all([
      ctx.http().post('/auth/otp/verify').send({ phone, code: OTP_TEST_CODE }),
      ctx.http().post('/auth/otp/verify').send({ phone, code: OTP_TEST_CODE }),
    ]);
    expect(twice.map((r) => r.status).sort()).toEqual([200, 401]);
  });
});
