import { createHmac } from 'node:crypto';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { PosService } from '../../src/modules/pos/pos.service';

const NOTE = 'e2e-pos';
const SECRET = 'pos-secret';

/** POS integration (docs/POS_ENTEGRASYONU.md): connection, push and auto-accept, signed status webhook, retries. */
describe('POS integration (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let itemId: string;

  const owner = () => bearer(ownerToken, restaurantId);
  const setSwitch = (enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/pos_integration`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const connect = (storeId: string, autoAccept: boolean, expected = 200) =>
    ctx
      .http()
      .put(`/restaurants/${restaurantId}/pos`)
      .set(owner())
      .send({ providerCode: 'MOCK', credentials: { storeId, secret: SECRET }, autoAccept, defaultPrepMinutes: 25 })
      .expect(expected);
  const phoneOrder = async () =>
    (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/orders`)
        .set(owner())
        .send({
          branchId,
          channel: 'PHONE',
          fulfillment: 'PICKUP',
          items: [{ menuItemId: itemId, quantity: 1 }],
          customer: { fullName: 'POS Musteri', phone: '0532 999 09 51' },
          note: NOTE,
        })
        .expect(201)
    ).body as { id: string };
  /** The push runs in the background after the order is published; wait for its row to settle. */
  const syncOf = async (orderId: string) => {
    for (let i = 0; i < 40; i += 1) {
      const sync = await ctx.prisma.posOrderSync.findUnique({ where: { orderId } });
      if (sync && sync.attempts > 0) return sync;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return ctx.prisma.posOrderSync.findUnique({ where: { orderId } });
  };
  const statusOf = async (orderId: string) =>
    (await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })).status;
  const webhook = (connectionId: string, payload: Record<string, unknown>, secret = SECRET) => {
    const body = JSON.stringify(payload);
    return ctx
      .http()
      .post(`/webhooks/pos/${connectionId}`)
      .set('content-type', 'application/json')
      .set('x-mock-signature', createHmac('sha256', secret).update(body).digest('hex'))
      .send(body);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, branches: { take: 1, select: { id: true } } },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    itemId = (await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, name: 'Izgara kofte' } })).id;
  });

  afterAll(async () => {
    await ctx.prisma.featureFlag.deleteMany({ where: { key: 'pos_integration' } });
    await ctx.prisma.posConnection.deleteMany({ where: { restaurantId } });
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.auditLog.deleteMany({ where: { action: { startsWith: 'pos.' } } });
    await ctx.close();
  });

  it('ships switched off: the screen is closed', async () => {
    const refused = await ctx.http().get(`/restaurants/${restaurantId}/pos`).set(owner()).expect(403);
    expect(refused.body.code).toBe('FEATURE_DISABLED');
  });

  it('connects, lists the partner POS systems and refuses one without an adapter', async () => {
    await setSwitch(true);
    const empty = await ctx.http().get(`/restaurants/${restaurantId}/pos`).set(owner()).expect(200);
    expect(empty.body.connection).toBeNull();
    expect((empty.body.providers as { code: string }[]).map((p) => p.code)).toContain('ROBOTPOS');
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/pos`)
      .set(owner())
      .send({ providerCode: 'ROBOTPOS', credentials: {}, autoAccept: false, defaultPrepMinutes: 20 })
      .expect(400);
    const failed = await connect('bad-store', true);
    expect(failed.body.connection).toMatchObject({ status: 'FAILED', failureReason: 'Store not found' });
    const ok = await connect('S1', true);
    expect(ok.body.connection).toMatchObject({ status: 'ACTIVE', label: 'Test POS S1', autoAccept: true });
    expect(JSON.stringify(ok.body)).not.toContain(SECRET);
  });

  it('pushes a new order and accepts it automatically, then follows the POS to ready', async () => {
    const order = await phoneOrder();
    const sync = await syncOf(order.id);
    expect(sync).toMatchObject({ status: 'SENT', externalRef: `mock-pos-${order.id}`, attempts: 1 });
    for (let i = 0; i < 40 && (await statusOf(order.id)) !== 'ACCEPTED'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await statusOf(order.id)).toBe('ACCEPTED');

    const connection = await ctx.prisma.posConnection.findUniqueOrThrow({ where: { restaurantId } });
    await webhook(connection.id, { externalRef: sync!.externalRef, kind: 'READY' }, 'wrong').expect(400);
    const ready = await webhook(connection.id, { externalRef: sync!.externalRef, kind: 'READY' }).expect(200);
    expect(ready.body).toEqual({ applied: true });
    expect(await statusOf(order.id)).toBe('READY');
    // A repeated event has nothing left to do.
    expect((await webhook(connection.id, { externalRef: sync!.externalRef, kind: 'READY' }).expect(200)).body).toEqual({
      applied: false,
    });
  });

  it('waits for the POS to accept when auto-accept is off, and lets it reject', async () => {
    await ctx.http().patch(`/restaurants/${restaurantId}/pos`).set(owner()).send({ autoAccept: false }).expect(200);
    const order = await phoneOrder();
    const sync = await syncOf(order.id);
    expect(sync?.status).toBe('SENT');
    expect(await statusOf(order.id)).toBe('PLACED');
    const connection = await ctx.prisma.posConnection.findUniqueOrThrow({ where: { restaurantId } });
    await webhook(connection.id, { externalRef: sync!.externalRef, kind: 'REJECTED', reason: 'Malzeme yok' }).expect(
      200,
    );
    expect(await statusOf(order.id)).toBe('REJECTED');
  });

  it('retries a push the POS refused, with backoff, and shows it on the screen', async () => {
    await connect('down-store', false);
    const order = await phoneOrder();
    const sync = await syncOf(order.id);
    expect(sync).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'Mock POS unreachable' });
    expect(sync!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    const pos = ctx.app.get(PosService);
    expect(await pos.retryDue(new Date())).toBe(0);
    expect(await pos.retryDue(new Date(Date.now() + 5 * 60_000))).toBe(0);
    const again = await ctx.prisma.posOrderSync.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(again.attempts).toBe(2);

    const screen = await ctx.http().get(`/restaurants/${restaurantId}/pos`).set(owner()).expect(200);
    expect(screen.body.connection.recent[0]).toMatchObject({ status: 'PENDING', attempts: 2 });

    await ctx.http().delete(`/restaurants/${restaurantId}/pos`).set(owner()).expect(200);
    await setSwitch(null);
  });
});
