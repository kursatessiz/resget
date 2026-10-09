import { SEED, createTestApp } from './support/app';
import type { TestContext } from './support/app';

describe('Public table menu (e2e)', () => {
  let ctx: TestContext;
  const session = `e2e-session-${Date.now()}`;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.prisma.qrScanEvent.deleteMany({ where: { sessionId: session } });
    await ctx.close();
  });

  it('serves the menu of the table behind the token without authentication', async () => {
    const res = await ctx.http().get(`/public/qr/${SEED.tableToken}`).expect(200);
    expect(res.body.restaurant.slug).toBe(SEED.restaurantSlug);
    expect(res.body.table.label).toBe('1');
    expect(res.body.categories.length).toBeGreaterThan(0);
    expect(res.body.categories[0].items[0].priceMinor).toBeGreaterThan(0);
    // Nothing internal leaks.
    expect(res.body.restaurant.isActive).toBeUndefined();
  });

  it('records one VIEWED_MENU funnel event per session and day, however often the menu is opened', async () => {
    await ctx.http().get(`/public/qr/${SEED.tableToken}`).set('x-qr-session', session).expect(200);
    await ctx.http().get(`/public/qr/${SEED.tableToken}`).set('x-qr-session', session).expect(200);
    const events = await ctx.prisma.qrScanEvent.findMany({ where: { sessionId: session } });
    expect(events).toHaveLength(1);
    expect(events.every((e) => e.outcome === 'VIEWED_MENU')).toBe(true);
  });

  it('returns TABLE_NOT_FOUND for an unknown token and VALIDATION for a malformed one', async () => {
    const unknown = await ctx.http().get('/public/qr/bilinmeyen-token-0000000000').expect(404);
    expect(unknown.body.code).toBe('TABLE_NOT_FOUND');
    const malformed = await ctx.http().get('/public/qr/kisa').expect(400);
    expect(malformed.body.code).toBe('VALIDATION');
  });
});
