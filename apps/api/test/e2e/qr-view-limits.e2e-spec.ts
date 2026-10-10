import type { TestContext } from './support/app';

const LIMIT = 5;
const DAY_MS = 86_400_000;

/** Cost limits on the unauthenticated table QR view and on the owner funnel read (docs/MASA_QR.md). */
describe('Table QR view limits (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let ownerToken: string;
  let SEED: typeof import('./support/app').SEED;
  let bearer: typeof import('./support/app').bearer;
  const prefix = `e2e-qrlimit-${Date.now()}`;

  beforeAll(async () => {
    // The API validates its environment when AppModule is imported, so the limit is set before the support module
    // (which imports AppModule) is loaded.
    process.env.PUBLIC_QR_VIEW_RATE_LIMIT = String(LIMIT);
    ({ SEED, bearer } = await import('./support/app'));
    ctx = await (await import('./support/app')).createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } });
    restaurantId = restaurant.id;
    ownerToken = await ctx.login(SEED.ownerPhone);
  });
  afterAll(async () => {
    await ctx.prisma.qrScanEvent.deleteMany({ where: { sessionId: { startsWith: prefix } } });
    await ctx.close();
  });

  const view = (client: string, session: string) =>
    ctx.http().get(`/public/qr/${SEED.tableToken}`).set('x-forwarded-for', client).set('x-qr-session', session);

  it('stops a client that opens the menu with fresh session ids from writing unbounded funnel rows', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 4; i += 1) {
      const res = await view('203.0.113.201', `${prefix}-flood-${String(i).padStart(4, '0')}`);
      statuses.push(res.status);
      if (res.status !== 200) {
        expect(res.status).toBe(403);
        expect(res.headers['x-error-code']).toBe('RATE_LIMITED');
      }
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(LIMIT);
    const rows = await ctx.prisma.qrScanEvent.count({ where: { sessionId: { startsWith: `${prefix}-flood-` } } });
    expect(rows).toBe(LIMIT);
  });

  it('counts each client on its own: another address still gets the menu', async () => {
    await view('203.0.113.202', `${prefix}-other-0001`).expect(200);
  });

  describe('funnel read', () => {
    const funnelPath = () => `/restaurants/${restaurantId}/tables/funnel`;
    const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY_MS).toISOString();

    it('refuses a range wider than 92 days and accepts one of exactly 92 days', async () => {
      const wide = await ctx
        .http()
        .get(funnelPath())
        .query({ from: iso(-200), to: iso(0) })
        .set(bearer(ownerToken))
        .expect(400);
      expect(wide.body.code).toBe('VALIDATION');
      // A start date alone ends today, so it is bounded the same way.
      await ctx
        .http()
        .get(funnelPath())
        .query({ from: iso(-200) })
        .set(bearer(ownerToken))
        .expect(400);
      const to = new Date();
      await ctx
        .http()
        .get(funnelPath())
        .query({ from: new Date(to.getTime() - 92 * DAY_MS).toISOString(), to: to.toISOString() })
        .set(bearer(ownerToken))
        .expect(200);
      await ctx.http().get(funnelPath()).set(bearer(ownerToken)).expect(200);
    });

    it('counts sessions per step with aggregate counts', async () => {
      const at = new Date(Date.now() - 60 * DAY_MS);
      const event = (n: string, outcome: 'VIEWED_MENU' | 'STARTED_ORDER' | 'PLACED_ORDER' | 'REGISTERED') => ({
        restaurantId,
        sessionId: `${prefix}-funnel-${n}`,
        outcome,
        createdAt: at,
      });
      await ctx.prisma.qrScanEvent.createMany({
        data: [
          event('a', 'VIEWED_MENU'),
          event('a', 'STARTED_ORDER'),
          event('a', 'PLACED_ORDER'),
          event('b', 'VIEWED_MENU'),
          event('b', 'VIEWED_MENU'),
          event('c', 'STARTED_ORDER'),
          event('d', 'VIEWED_MENU'),
          event('d', 'REGISTERED'),
        ],
      });
      const res = await ctx
        .http()
        .get(funnelPath())
        .query({ from: new Date(at.getTime() - 1000).toISOString(), to: new Date(at.getTime() + 1000).toISOString() })
        .set(bearer(ownerToken))
        .expect(200);
      expect(res.body).toEqual({
        sessions: 4,
        viewedMenu: 4,
        startedOrder: 2,
        placedOrder: 1,
        registered: 1,
        viewToOrderRate: 0.25,
        viewToRegisterRate: 0.25,
      });
    });
  });
});
