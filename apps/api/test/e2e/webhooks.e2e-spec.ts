import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import {
  API_KEY_HEADER,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  parseWebhookSignature,
  webhookSignedPayload,
} from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { WebhooksService } from '../../src/modules/webhooks/webhooks.service';

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

/** Outbound webhooks (docs/API_ERISIMI.md): signed delivery, retry on failure, pause, test ping; per-key rate limit. */
describe('Webhooks (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let menuItemId: string;
  let server: Server;
  let baseUrl: string;
  let respondWith = 200;
  const received: Received[] = [];
  let webhookId: string;
  let secret: string;
  const orderIds: string[] = [];
  let service: WebhooksService;

  beforeAll(async () => {
    ctx = await createTestApp();
    service = ctx.app.get(WebhooksService);
    ownerToken = await ctx.login(SEED.ownerPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, branches: { take: 1, select: { id: true } } },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    menuItemId = (
      await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, isAvailable: true }, select: { id: true } })
    ).id;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.statusCode = respondWith;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await ctx.prisma.restaurantWebhook.deleteMany({ where: { restaurantId, url: { startsWith: baseUrl } } });
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await ctx.close();
  });

  it('registers a hook with a one-time secret and delivers a signed order event', async () => {
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/webhooks`)
      .set(bearer(ownerToken, restaurantId))
      .send({ url: `${baseUrl}/hook`, events: ['order.updated', 'rating.created'] })
      .expect(201);
    webhookId = created.body.id as string;
    secret = created.body.secret as string;
    expect(secret).toMatch(/^whsec_/);
    const list = await ctx.http().get(`/restaurants/${restaurantId}/webhooks`).set(bearer(ownerToken, restaurantId));
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(secret);

    const order = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken, restaurantId))
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity: 1 }],
        customer: { fullName: 'Webhook Musteri', phone: '05329990961' },
      })
      .expect(201);
    orderIds.push(order.body.id as string);

    const sent = await service.runPass();
    expect(sent).toBeGreaterThanOrEqual(1);
    const delivery = received.find((r) => r.body.includes(order.body.id as string));
    expect(delivery).toBeDefined();
    expect(delivery!.headers[WEBHOOK_EVENT_HEADER]).toBe('order.updated');
    expect(delivery!.headers[WEBHOOK_DELIVERY_HEADER]).toBeTruthy();
    const signature = parseWebhookSignature(String(delivery!.headers[WEBHOOK_SIGNATURE_HEADER]));
    expect(signature).not.toBeNull();
    const expected = createHmac('sha256', secret)
      .update(webhookSignedPayload(signature!.timestamp, delivery!.body))
      .digest('hex');
    expect(signature!.digest).toBe(expected);
    const envelope = JSON.parse(delivery!.body) as { event: string; data: { id: string; status: string } };
    expect(envelope.event).toBe('order.updated');
    expect(envelope.data.status).toBe('PLACED');

    const deliveries = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/webhooks/${webhookId}/deliveries`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(deliveries.body[0]).toMatchObject({
      event: 'order.updated',
      status: 'SENT',
      attempts: 1,
      responseStatus: 200,
    });
  });

  it('retries a failed delivery with backoff, queues a test ping, and can be paused and deleted', async () => {
    respondWith = 500;
    const test = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/webhooks/${webhookId}/test`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(test.body.status).toBe('PENDING');
    await service.runPass();
    const failed = await ctx.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: test.body.id as string } });
    expect(failed.status).toBe('PENDING');
    expect(failed.attempts).toBe(1);
    expect(failed.responseStatus).toBe(500);
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    const hook = await ctx.prisma.restaurantWebhook.findUniqueOrThrow({ where: { id: webhookId } });
    expect(hook.failureCount).toBe(1);
    // Not due yet: a second pass leaves it alone.
    await service.runPass();
    expect((await ctx.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: failed.id } })).attempts).toBe(1);
    // Due now and the receiver is healthy again: delivered, streak reset.
    respondWith = 200;
    await ctx.prisma.webhookDelivery.update({ where: { id: failed.id }, data: { nextAttemptAt: new Date() } });
    await service.runPass();
    expect((await ctx.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe('SENT');
    expect((await ctx.prisma.restaurantWebhook.findUniqueOrThrow({ where: { id: webhookId } })).failureCount).toBe(0);

    const paused = await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/webhooks/${webhookId}`)
      .set(bearer(ownerToken, restaurantId))
      .send({ isActive: false })
      .expect(200);
    expect(paused.body.isActive).toBe(false);
    const before = received.length;
    const order = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken, restaurantId))
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity: 1 }],
        customer: { fullName: 'Webhook Musteri', phone: '05329990961' },
      })
      .expect(201);
    orderIds.push(order.body.id as string);
    await service.runPass();
    expect(received.length).toBe(before);

    await ctx
      .http()
      .delete(`/restaurants/${restaurantId}/webhooks/${webhookId}`)
      .set(bearer(ownerToken, restaurantId))
      .expect(204);
    await ctx
      .http()
      .delete(`/restaurants/${restaurantId}/webhooks/${webhookId}`)
      .set(bearer(ownerToken, restaurantId))
      .expect(404)
      .expect('x-error-code', 'WEBHOOK_NOT_FOUND');
  });

  it('pushes staff menu edits and sends a failed delivery again on request', async () => {
    respondWith = 200;
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/webhooks`)
      .set(bearer(ownerToken, restaurantId))
      .send({ url: `${baseUrl}/menu-hook`, events: ['menu.item.updated', 'menu.updated'] })
      .expect(201);
    const hookId = created.body.id as string;
    const owner = bearer(ownerToken, restaurantId);

    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/menu/items/${menuItemId}`)
      .set(owner)
      .send({ isAvailable: false })
      .expect(200);
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/menu/items/${menuItemId}`)
      .set(owner)
      .send({ isAvailable: true })
      .expect(200);
    const category = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/menu/categories`)
      .set(owner)
      .send({ name: 'E2E Webhook kategori' })
      .expect(201);
    await ctx
      .http()
      .delete(`/restaurants/${restaurantId}/menu/categories/${category.body.id as string}`)
      .set(owner)
      .expect(204);

    const before = received.length;
    await service.runPass();
    const bodies = received
      .slice(before)
      .filter((r) => r.headers[WEBHOOK_DELIVERY_HEADER] !== undefined)
      .map(
        (r) =>
          JSON.parse(r.body) as {
            event: string;
            data: { change: string; itemId?: string; categoryId?: string | null; item?: { isAvailable: boolean } };
          },
      );
    const itemEvents = bodies.filter((b) => b.event === 'menu.item.updated');
    expect(itemEvents.map((b) => [b.data.change, b.data.itemId, b.data.item?.isAvailable])).toEqual([
      ['UPDATED', menuItemId, false],
      ['UPDATED', menuItemId, true],
    ]);
    const menuEvents = bodies.filter((b) => b.event === 'menu.updated');
    expect(menuEvents.map((b) => [b.data.change, b.data.categoryId])).toEqual([
      ['CATEGORY_CREATED', category.body.id],
      ['CATEGORY_DELETED', category.body.id],
    ]);
    // Order changes are not on this hook's list.
    expect(bodies.some((b) => b.event === 'order.updated')).toBe(false);

    const sent = await ctx.prisma.webhookDelivery.findFirstOrThrow({ where: { webhookId: hookId, status: 'SENT' } });
    const redeliver = (deliveryId: string, status: number) =>
      ctx
        .http()
        .post(`/restaurants/${restaurantId}/webhooks/${hookId}/deliveries/${deliveryId}/redeliver`)
        .set(owner)
        .expect(status);
    expect((await redeliver(sent.id, 409)).headers['x-error-code']).toBe('WEBHOOK_REDELIVERY_NOT_ALLOWED');
    expect((await redeliver('00000000-0000-4000-8000-000000000000', 404)).headers['x-error-code']).toBe(
      'WEBHOOK_NOT_FOUND',
    );
    // A delivery that ran out of attempts goes back on the queue under the same id.
    await ctx.prisma.webhookDelivery.update({
      where: { id: sent.id },
      data: { status: 'FAILED', attempts: 6, responseStatus: 500, lastError: 'HTTP 500' },
    });
    const queued = (await redeliver(sent.id, 200)).body as {
      status: string;
      attempts: number;
      lastError: string | null;
    };
    expect(queued).toMatchObject({ status: 'PENDING', attempts: 0, lastError: null });
    const mark = received.length;
    await service.runPass();
    expect(received.slice(mark).some((r) => r.headers[WEBHOOK_DELIVERY_HEADER] === sent.id)).toBe(true);
    expect((await ctx.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: sent.id } })).status).toBe('SENT');

    // A paused endpoint takes no redelivery.
    await ctx.prisma.webhookDelivery.update({ where: { id: sent.id }, data: { status: 'FAILED' } });
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/webhooks/${hookId}`)
      .set(owner)
      .send({ isActive: false })
      .expect(200);
    expect((await redeliver(sent.id, 409)).headers['x-error-code']).toBe('WEBHOOK_REDELIVERY_NOT_ALLOWED');
    await ctx.http().delete(`/restaurants/${restaurantId}/webhooks/${hookId}`).set(owner).expect(204);
  });

  it('refuses webhook management with an API key and limits a key per minute', async () => {
    const key = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/api-keys`)
      .set(bearer(ownerToken, restaurantId))
      .send({ name: 'E2E Webhook limit', permissions: ['orders.view'] })
      .expect(201);
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/webhooks`)
      .set(API_KEY_HEADER, key.body.token as string)
      .expect(403);
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/orders`)
      .set(API_KEY_HEADER, key.body.token as string)
      .expect(200);
    await ctx.prisma.restaurantApiKey.delete({ where: { id: key.body.id as string } });
  });
});
