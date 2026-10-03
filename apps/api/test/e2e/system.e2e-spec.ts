import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** The console's system page (docs/PLATFORM_YONETIMI.md): live components, jobs, providers and counters. */
describe('System health (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login(SEED.superAdminPhone);
    ownerToken = await ctx.login(SEED.ownerPhone);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('measures the database, reports the providers with their balances and counts the last 24 hours', async () => {
    const res = await ctx.http().get('/admin/system').set(bearer(adminToken)).expect(200);
    expect(res.body.database.status).toBe('ok');
    expect(res.body.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(['ok', 'not_configured']).toContain(res.body.redis.status);
    expect(res.body.providers.sms).toMatchObject({ code: 'MOCK', balance: 10000, low: false });
    expect(res.body.providers.payment).toBe('MOCK');
    expect(res.body.jobs.orderWatchdog).toBe('on');
    expect(typeof res.body.activity.ordersLast24h).toBe('number');
    expect(res.body.activity.activeRestaurants).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.wallets)).toBe(true);
  });

  it('shows when the billing job last ran once it has run', async () => {
    await ctx.http().post('/admin/billing/run').set(bearer(adminToken)).send({}).expect(200);
    const res = await ctx.http().get('/admin/system').set(bearer(adminToken)).expect(200);
    expect(res.body.jobs.billingLastRunAt).not.toBeNull();
    expect(Date.now() - new Date(res.body.jobs.billingLastRunAt).getTime()).toBeLessThan(60_000);
  });

  it('is closed to restaurant owners', async () => {
    await ctx.http().get('/admin/system').set(bearer(ownerToken)).expect(403);
  });
});
