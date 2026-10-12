import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { deleteTestRestaurants } from './support/cleanup';

/** Self-service sign-up is rate limited per user and grants the trial and welcome credits once (docs/PLAN_MATRISI.md). */
describe('Restaurant sign-up limits (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  const createdRestaurants: string[] = [];
  const stamp = String(Date.now()).slice(-6);
  const SIGNUP_PHONE = normalizePhone(`05361${stamp}`)!;
  const OWNER_PHONE = normalizePhone(`05362${stamp}`)!;

  const body = (name: string) => ({
    name: `${name} ${stamp}`,
    countryCode: 'TR',
    currency: 'TRY',
    timezone: 'Europe/Istanbul',
    defaultLocale: 'tr',
    branch: { addressLine: 'Moda Cad. No 1', city: 'Istanbul', district: 'Kadikoy' },
  });
  const signup = (token: string, name: string) => ctx.http().post('/restaurants').set(bearer(token)).send(body(name));
  const grantsOf = async (restaurantId: string) => {
    const subscription = await ctx.prisma.restaurantSubscription.findUniqueOrThrow({
      where: { restaurantId },
      include: { plan: { select: { code: true } } },
    });
    const wallets = await ctx.prisma.messageWallet.findMany({
      where: { restaurantId },
      include: { transactions: { select: { type: true, reference: true } } },
    });
    return {
      plan: subscription.plan.code,
      status: subscription.status,
      balances: wallets.map((w) => w.balance),
      grants: wallets.flatMap((w) => w.transactions.filter((t) => t.reference === 'welcome')).length,
    };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login(SEED.superAdminPhone);
  });

  afterAll(async () => {
    await deleteTestRestaurants(ctx.prisma, { id: { in: createdRestaurants } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: [SIGNUP_PHONE, OWNER_PHONE] } } });
    await ctx.close();
  });

  it('grants the trial and welcome credits to the first restaurant, then creates the rest on BASIC without credits, up to a daily cap', async () => {
    const token = await ctx.login(SIGNUP_PHONE);
    const first = await signup(token, 'Limit Bir').expect(201);
    createdRestaurants.push(first.body.id as string);
    expect(await grantsOf(first.body.id as string)).toEqual({
      plan: 'PRO',
      status: 'TRIALING',
      balances: [25, 25],
      grants: 2,
    });

    for (const name of ['Limit Iki', 'Limit Uc']) {
      const next = await signup(token, name).expect(201);
      createdRestaurants.push(next.body.id as string);
      expect(await grantsOf(next.body.id as string)).toEqual({
        plan: 'BASIC',
        status: 'ACTIVE',
        balances: [0, 0],
        grants: 0,
      });
    }

    await signup(token, 'Limit Dort').expect(429).expect('x-error-code', 'RESTAURANT_SIGNUP_LIMIT');
    expect(await ctx.prisma.restaurant.count({ where: { name: { contains: `Limit Dort ${stamp}` } } })).toBe(0);
  });

  it('does not limit the console, which creates restaurants with the trial for any owner', async () => {
    for (let i = 0; i < 4; i += 1) {
      const res = await ctx
        .http()
        .post('/admin/restaurants')
        .set(bearer(adminToken))
        .send({ ...body(`Konsol Limit ${i}`), ownerPhone: OWNER_PHONE, ownerName: 'Limit Sahip' })
        .expect(201);
      createdRestaurants.push(res.body.id as string);
      expect(await grantsOf(res.body.id as string)).toMatchObject({ plan: 'PRO', status: 'TRIALING', grants: 2 });
    }
  });
});
