import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_DELIVERY_RETENTION_DAYS,
  WEBHOOK_PASS_PER_RESTAURANT,
  WEBHOOK_TEST_PENDING_MAX,
  WEBHOOK_TEST_RATE_LIMIT,
  normalizePhone,
} from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { deleteTestRestaurants } from './support/cleanup';
import { WebhooksService } from '../../src/modules/webhooks/webhooks.service';
import { WebhooksRunner } from '../../src/modules/webhooks/webhooks.runner';

const MEMBER_PHONE = normalizePhone('0532 999 06 81')!;
const CUSTOMER_PHONE = normalizePhone('0532 999 06 82')!;
const ERASED_PHONE = normalizePhone('0532 999 06 83')!;
const NOTE = 'e2e-webhook-privacy';
const ROLE_NAME = 'E2E Webhook Entegrasyon';
const OTHER_SLUG = 'e2e-webhook-diger';
const DAY_MS = 86_400_000;
const OTP_TEST_CODE = process.env.OTP_TEST_CODE ?? '482915';

interface Received {
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}

const digits = (phone: string) => phone.replace(/\D/g, '');

/**
 * Webhook bodies as an export channel (docs/API_ERISIMI.md, docs/KISISEL_VERI.md): bound to the creator's contact
 * permission, erased with the person, purged after the retention period; test pings and the runner shared fairly.
 */
describe('Webhook privacy and fairness (e2e)', () => {
  let ctx: TestContext;
  let service: WebhooksService;
  let runner: WebhooksRunner;
  let ownerToken: string;
  let restaurantId: string;
  let otherRestaurantId: string;
  let branchId: string;
  let menuItemId: string;
  let server: Server;
  let baseUrl: string;
  const received: Received[] = [];
  const userIds: string[] = [];

  const owner = () => bearer(ownerToken, restaurantId);
  const createHook = async (token: string, path: string, events = ['order.updated', 'rating.created']) =>
    (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/webhooks`)
        .set(bearer(token, restaurantId))
        .send({ url: `${baseUrl}${path}`, events })
        .expect(201)
    ).body as { id: string };
  const deliveryOrder = async (phone: string, name: string) =>
    (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/orders`)
        .set(owner())
        .send({
          branchId,
          channel: 'PHONE',
          fulfillment: 'DELIVERY',
          items: [{ menuItemId, quantity: 1 }],
          customer: { fullName: name, phone },
          address: {
            addressLine: 'Gizli Webhook Sok. No 7',
            city: 'Istanbul',
            district: 'Kadikoy',
            note: 'Kapida bekle',
            contactName: name,
            contactPhone: phone,
            point: { lat: 40.988, lng: 29.027 },
          },
          payment: { method: 'CASH_ON_DELIVERY' },
          note: NOTE,
        })
        .expect(201)
    ).body as { id: string };
  const transition = (orderId: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${orderId}/transition`)
      .set(owner())
      .send({ to, ...extra })
      .expect(200);
  const bodiesAt = (path: string) =>
    received
      .filter((r) => r.path === path)
      .map((r) => JSON.parse(r.body) as { event: string; data: Record<string, unknown> });

  const cleanup = async () => {
    await ctx.prisma.restaurantWebhook.deleteMany({ where: { url: { contains: '/privacy-' } } });
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    const users = await ctx.prisma.user.findMany({
      where: { OR: [{ phone: { in: [MEMBER_PHONE, CUSTOMER_PHONE, ERASED_PHONE] } }, { id: { in: userIds } }] },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await ctx.prisma.order.deleteMany({ where: { customerUserId: { in: ids } } });
    await ctx.prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await ctx.prisma.membership.deleteMany({ where: { userId: { in: ids } } });
    await ctx.prisma.user.deleteMany({ where: { id: { in: ids } } });
    await ctx.prisma.roleTemplate.deleteMany({ where: { restaurantId, name: ROLE_NAME } });
    await deleteTestRestaurants(ctx.prisma, { slug: OTHER_SLUG });
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    service = ctx.app.get(WebhooksService);
    runner = ctx.app.get(WebhooksRunner);
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
    await cleanup();
    otherRestaurantId = (
      await ctx.prisma.restaurant.create({
        data: { slug: OTHER_SLUG, name: 'E2E Webhook Diger', countryCode: 'TR', currency: 'TRY', timezone: 'UTC' },
      })
    ).id;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        const path = req.url ?? '/';
        received.push({ path, headers: req.headers, body });
        res.statusCode = path.includes('fail') ? 500 : 200;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await cleanup();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await ctx.close();
  });

  it('masks customer contact numbers on a hook whose creator may not see contacts', async () => {
    // A delegate with integrations.manage but without customers.contact.view.
    const role = await ctx.prisma.roleTemplate.create({
      data: {
        restaurantId,
        name: ROLE_NAME,
        isOwner: false,
        permissions: { create: ['integrations.manage', 'orders.view'].map((permissionKey) => ({ permissionKey })) },
      },
    });
    const member = await ctx.prisma.user.create({ data: { phone: MEMBER_PHONE, fullName: 'E2E Entegrasyon' } });
    await ctx.prisma.membership.create({
      data: { userId: member.id, restaurantId, roleTemplateId: role.id, status: 'ACTIVE', joinedAt: new Date() },
    });
    const memberToken = await ctx.login(MEMBER_PHONE);
    await createHook(memberToken, '/privacy-member');
    await createHook(ownerToken, '/privacy-owner');

    const order = await deliveryOrder(CUSTOMER_PHONE, 'Webhook Maske Musteri');
    // The member's own REST read is masked.
    const read = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/orders/${order.id}`)
      .set(bearer(memberToken, restaurantId))
      .expect(200);
    expect(JSON.stringify(read.body)).not.toContain(digits(CUSTOMER_PHONE));

    await service.runPass();
    const memberBody = bodiesAt('/privacy-member').find((b) => b.data.id === order.id);
    const ownerBody = bodiesAt('/privacy-owner').find((b) => b.data.id === order.id);
    expect(memberBody).toBeDefined();
    expect(ownerBody).toBeDefined();
    // The owner holds every permission: full numbers.
    expect(JSON.stringify(ownerBody)).toContain(CUSTOMER_PHONE);
    // The delegate's hook gets what the delegate's own screens show.
    const memberData = memberBody!.data as { customer: { phone: string }; address: { contactPhone: string } };
    expect(JSON.stringify(memberBody)).not.toContain(digits(CUSTOMER_PHONE).slice(-7));
    expect(memberData.customer.phone).toContain('*');
    expect(memberData.address.contactPhone).toContain('*');

    // Granting the permission later lifts the mask on the next delivery: the binding is checked at send time.
    await ctx.prisma.roleTemplatePermission.create({
      data: { roleTemplateId: role.id, permissionKey: 'customers.contact.view' },
    });
    await transition(order.id, 'REJECTED');
    await service.runPass();
    const later = bodiesAt('/privacy-member').filter((b) => b.data.id === order.id);
    expect(JSON.stringify(later[later.length - 1])).toContain(CUSTOMER_PHONE);
  });

  it('erases the person from queued deliveries when the account is deleted and refuses to replay them', async () => {
    const hook = await createHook(ownerToken, '/privacy-fail');
    const order = await deliveryOrder(ERASED_PHONE, 'Webhook Silinen Musteri');
    await transition(order.id, 'ACCEPTED', { prepMinutes: 10 });
    await transition(order.id, 'READY');
    await transition(order.id, 'OUT_FOR_DELIVERY');
    await transition(order.id, 'DELIVERED');
    // The receiver fails: rows wait for a retry. One ran out of attempts, one went through earlier.
    await service.runPass();
    const rows = await ctx.prisma.webhookDelivery.findMany({
      where: { webhookId: hook.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    await ctx.prisma.webhookDelivery.update({ where: { id: rows[0].id }, data: { status: 'FAILED', attempts: 6 } });
    await ctx.prisma.webhookDelivery.update({
      where: { id: rows[1].id },
      data: { status: 'SENT', sentAt: new Date() },
    });
    await ctx.prisma.webhookDelivery.create({
      data: {
        webhookId: hook.id,
        restaurantId,
        event: 'rating.created',
        status: 'FAILED',
        attempts: 6,
        payload: { orderId: order.id, shortCode: 'X', score: 2, comment: 'Gizli yorum metni' },
      },
    });
    const before = JSON.stringify(
      (await ctx.prisma.webhookDelivery.findMany({ where: { webhookId: hook.id } })).map((r) => r.payload),
    );
    expect(before).toContain(ERASED_PHONE);
    expect(before).toContain('Webhook Silinen Musteri');

    await ctx.prisma.otpCode.deleteMany({ where: { phone: ERASED_PHONE } });
    await ctx.http().post('/auth/otp/request').send({ phone: ERASED_PHONE }).expect(200);
    const signedIn = await ctx
      .http()
      .post('/auth/otp/verify')
      .send({ phone: ERASED_PHONE, code: OTP_TEST_CODE })
      .expect(200);
    const userId = (await ctx.prisma.user.findUniqueOrThrow({ where: { phone: ERASED_PHONE } })).id;
    userIds.push(userId);
    await ctx
      .http()
      .post('/me/account/delete')
      .set(bearer(signedIn.body.accessToken as string))
      .send({ confirm: true })
      .expect(204);

    const after = await ctx.prisma.webhookDelivery.findMany({ where: { webhookId: hook.id } });
    const text = JSON.stringify(after.map((r) => r.payload));
    for (const secret of [digits(ERASED_PHONE), 'Webhook Silinen Musteri', 'Gizli Webhook Sok', 'Kapida bekle', NOTE]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain('Gizli yorum metni');
    // Nothing about the person is waiting to be sent or sent again.
    expect(after.filter((r) => r.status !== 'SENT')).toHaveLength(0);

    // A failed delivery about the deleted person (say, one that changed after the deletion) is not replayed.
    const late = await ctx.prisma.webhookDelivery.create({
      data: {
        webhookId: hook.id,
        restaurantId,
        event: 'order.updated',
        status: 'FAILED',
        attempts: 6,
        payload: { id: order.id, customer: { userId, fullName: null, phone: null } },
      },
    });
    await ctx.prisma.restaurantWebhook.update({
      where: { id: hook.id },
      data: { url: `${baseUrl}/privacy-new`, isActive: true },
    });
    const refused = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/webhooks/${hook.id}/deliveries/${late.id}/redeliver`)
      .set(owner())
      .expect(409);
    expect(refused.headers['x-error-code']).toBe('WEBHOOK_REDELIVERY_NOT_ALLOWED');
  });

  it('deletes sent and failed deliveries after the retention period', async () => {
    const hook = await createHook(ownerToken, '/privacy-retention');
    const old = new Date(Date.now() - (WEBHOOK_DELIVERY_RETENTION_DAYS + 1) * DAY_MS);
    const make = (status: 'SENT' | 'FAILED' | 'PENDING', createdAt: Date) =>
      ctx.prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          restaurantId,
          event: 'order.updated',
          status,
          createdAt,
          nextAttemptAt: new Date(Date.now() + DAY_MS),
          payload: { test: true },
        },
      });
    const oldSent = await make('SENT', old);
    const oldFailed = await make('FAILED', old);
    const freshSent = await make('SENT', new Date());
    const oldPending = await make('PENDING', old);
    await runner.tick(new Date());
    const left = (await ctx.prisma.webhookDelivery.findMany({ where: { webhookId: hook.id } })).map((r) => r.id);
    expect(left).not.toContain(oldSent.id);
    expect(left).not.toContain(oldFailed.id);
    expect(left).toEqual(expect.arrayContaining([freshSent.id, oldPending.id]));
  });

  it('caps waiting test deliveries per hook and limits test requests', async () => {
    const hook = await createHook(ownerToken, '/privacy-test-cap');
    const ping = () => ctx.http().post(`/restaurants/${restaurantId}/webhooks/${hook.id}/test`).set(owner());
    for (let i = 0; i < WEBHOOK_TEST_PENDING_MAX; i += 1) await ping().expect(200);
    const capped = await ping().expect(409);
    expect(capped.headers['x-error-code']).toBe('WEBHOOK_TEST_LIMIT');
    // Drained queue: tests are accepted again, up to the per-window limit.
    let limited = false;
    for (let i = 0; i <= WEBHOOK_TEST_RATE_LIMIT; i += 1) {
      await ctx.prisma.webhookDelivery.updateMany({ where: { webhookId: hook.id }, data: { status: 'SENT' } });
      const res = await ping();
      if (res.status === 403) {
        expect(res.headers['x-error-code']).toBe('RATE_LIMITED');
        limited = true;
        break;
      }
      expect(res.status).toBe(200);
    }
    expect(limited).toBe(true);
  });

  it('shares one runner pass between restaurants so a long queue cannot hold the others', async () => {
    const busy = await createHook(ownerToken, '/privacy-busy', ['order.updated']);
    const quiet = await ctx.prisma.restaurantWebhook.create({
      data: {
        restaurantId: otherRestaurantId,
        url: `${baseUrl}/privacy-quiet`,
        events: ['order.updated'],
        secretEncrypted: (await ctx.prisma.restaurantWebhook.findUniqueOrThrow({ where: { id: busy.id } }))
          .secretEncrypted,
      },
    });
    const now = new Date();
    await ctx.prisma.webhookDelivery.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        webhookId: busy.id,
        restaurantId,
        event: 'order.updated',
        payload: { test: true, n: i },
        nextAttemptAt: new Date(now.getTime() - 600_000 + i),
      })),
    });
    const waiting = await ctx.prisma.webhookDelivery.create({
      data: {
        webhookId: quiet.id,
        restaurantId: otherRestaurantId,
        event: 'order.updated',
        payload: { test: true },
        nextAttemptAt: new Date(now.getTime() - 60_000),
      },
    });
    const mark = received.length;
    await service.runPass(now);
    expect((await ctx.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe('SENT');
    const sentBusy = received.slice(mark).filter((r) => r.path === '/privacy-busy');
    expect(sentBusy.length).toBeLessThanOrEqual(WEBHOOK_PASS_PER_RESTAURANT);
    expect(received.slice(mark).some((r) => r.headers[WEBHOOK_DELIVERY_HEADER] === waiting.id)).toBe(true);
  });
});
