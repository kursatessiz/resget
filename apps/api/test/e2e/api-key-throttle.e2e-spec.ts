import { API_KEY_HEADER, parseApiKeyToken } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { ApiKeysService } from '../../src/modules/auth/api-keys.service';

/** Failed API key verifications are counted per key and per client before the secret is hashed (docs/API_ERISIMI.md). */
describe('API key failure throttle (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let ownerToken: string;
  let token: string;
  let keyId: string;
  let hashSpy: jest.SpyInstance;
  const extraKeyIds: string[] = [];

  const orders = (key: string, client: string) =>
    ctx.http().get(`/restaurants/${restaurantId}/orders`).set(API_KEY_HEADER, key).set('x-forwarded-for', client);
  /** A well-formed token for the key with a wrong secret. */
  const wrong = (n: number) => `rsk_${parseApiKeyToken(token)!.keyId}_${String(n).padStart(43, 'x')}`;

  beforeAll(async () => {
    ctx = await createTestApp();
    ownerToken = await ctx.login(SEED.ownerPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } });
    restaurantId = restaurant.id;
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/api-keys`)
      .set(bearer(ownerToken, restaurantId))
      .send({ name: 'E2E Throttle', permissions: ['orders.view'] })
      .expect(201);
    token = created.body.token as string;
    keyId = created.body.id as string;
    // The verification step is the expensive one; the spy counts how often it runs, whether it is sync or async.
    const service = ctx.app.get(ApiKeysService, { strict: false });
    hashSpy = jest.spyOn(service as unknown as { hash: (keyId: string, secret: string) => unknown }, 'hash');
  });

  afterAll(async () => {
    hashSpy.mockRestore();
    await ctx.prisma.restaurantApiKey.deleteMany({ where: { id: { in: [keyId, ...extraKeyIds] } } });
    await ctx.close();
  });

  it('stops hashing wrong secrets for a known key id after a few failures and answers 429', async () => {
    hashSpy.mockClear();
    const client = '203.0.113.10';
    const statuses: number[] = [];
    for (let i = 0; i < 16; i += 1) statuses.push((await orders(wrong(i), client)).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses.slice(10)).toEqual(Array(6).fill(429));
    // Refused attempts never reached the hash.
    expect(hashSpy.mock.calls.length).toBeLessThanOrEqual(10);
    await orders(wrong(99), client).expect(429).expect('x-error-code', 'RATE_LIMITED');
    // Someone who only knows the key id cannot lock the integration out from another address.
    await orders(token, '203.0.113.14').expect(200);
  });

  it('does not hash again for the same token written with padding that parsing strips', async () => {
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/api-keys`)
      .set(bearer(ownerToken, restaurantId))
      .send({ name: 'E2E Padding', permissions: ['orders.view'] })
      .expect(201);
    const fresh = created.body.token as string;
    extraKeyIds.push(created.body.id as string);
    hashSpy.mockClear();
    const client = '203.0.113.11';
    await orders(fresh, client).expect(200);
    // Header values are not trimmed of U+00A0 by the HTTP layer, but token parsing trims it.
    for (let i = 1; i <= 4; i += 1) await orders(`${'\u00a0'.repeat(i)}${fresh}`, client).expect(200);
    expect(hashSpy.mock.calls.length).toBe(1);
  });

  it('counts unknown key ids against the client address and refuses past the limit', async () => {
    const client = '203.0.113.12';
    const statuses: number[] = [];
    for (let i = 0; i < 36; i += 1) {
      const id = i.toString(16).padStart(16, 'a');
      statuses.push((await orders(`rsk_${id}_${'y'.repeat(43)}`, client)).status);
    }
    expect(statuses.slice(0, 30)).toEqual(Array(30).fill(401));
    expect(statuses.slice(30)).toEqual(Array(6).fill(429));
    // Another client address is unaffected.
    await orders(token, '203.0.113.13').expect(200);
  });
});
