import { createTestApp } from './support/app';
import type { TestContext } from './support/app';

describe('Health (e2e)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('reports ok with the database reachable', async () => {
    const res = await ctx.http().get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database.status).toBe('ok');
    expect(['ok', 'not_configured']).toContain(res.body.redis.status);
  });
});
