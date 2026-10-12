import { createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Provider notification routes are unauthenticated, so each client address gets a request budget (docs/ODEME.md). */
describe('Webhook rate limit (e2e)', () => {
  let ctx: TestContext;
  const client = '203.0.113.50';
  const CONNECTION = '00000000-0000-4000-8000-0000000000aa';

  const hit = (path: string) =>
    ctx.http().post(path).set('x-forwarded-for', client).set('content-type', 'text/plain').send('token=x');
  const routes = [
    '/webhooks/payments/platform/MOCK',
    `/webhooks/payments/pos/${CONNECTION}`,
    `/webhooks/pos/${CONNECTION}`,
    '/webhooks/courier/MOCK',
  ];

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('answers a flood of notifications from one address with RATE_LIMITED, across payment, POS and courier routes', async () => {
    // The default budget is 600 per minute per address, shared by the notification routes.
    const statuses: number[] = [];
    for (let i = 0; i < 600; i += 1) statuses.push((await hit(routes[i % routes.length])).status);
    expect(statuses.filter((s) => s === 403)).toHaveLength(0);
    for (const route of routes) {
      await hit(route).expect(403).expect('x-error-code', 'RATE_LIMITED');
    }
    // Another address keeps its own budget.
    const other = await ctx
      .http()
      .post(routes[0])
      .set('x-forwarded-for', '203.0.113.51')
      .set('content-type', 'text/plain')
      .send('token=x');
    expect(other.status).toBe(400);
  });
});
