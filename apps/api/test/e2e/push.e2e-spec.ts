import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Push notifications: device registry, customer push instead of the paid message, gone device fallback, staff alert (docs/MESAJLASMA.md). */
describe('Push notifications (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let ownerToken: string;
  let guestToken: string;
  let guestUserId: string;
  let menuItemId: string;
  const GOOD = 'ExponentPushToken[e2e-guest-phone-0001]';
  const GONE = 'ExponentPushToken[e2e-guest-gone-0002]';
  const OWNER = 'ExponentPushToken[e2e-owner-phone-0003]';
  const created: string[] = [];

  const smsLogs = (templateKey: string) =>
    ctx.prisma.messageLog.count({ where: { restaurantId, channel: { in: ['SMS', 'WHATSAPP'] }, templateKey } });
  const pushLogs = (templateKey: string) =>
    ctx.prisma.messageLog.findMany({
      where: { restaurantId, channel: 'PUSH', templateKey },
      orderBy: { createdAt: 'desc' },
    });
  const transition = (orderId: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${orderId}/transition`)
      .set(bearer(ownerToken))
      .send({ to, ...extra })
      .expect(200);
  const placeAsGuest = async () => {
    const res = await ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .set(bearer(guestToken))
      .send({
        fulfillment: 'DELIVERY',
        items: [{ menuItemId, quantity: 1 }],
        address: {
          addressLine: 'Moda Cad. No 11',
          city: 'Istanbul',
          district: 'Kadikoy',
          contactName: 'Push Musteri',
          contactPhone: SEED.guestPhone,
          point: { lat: 40.985, lng: 29.03 },
        },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(201);
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: res.body.trackingToken } });
    created.push(order.id);
    return order;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { menuItems: { where: { isAvailable: true }, take: 1 } },
    });
    restaurantId = restaurant.id;
    menuItemId = restaurant.menuItems[0].id;
    [ownerToken, guestToken] = await Promise.all([ctx.login(SEED.ownerPhone), ctx.login(SEED.guestPhone)]);
    guestUserId = (await ctx.prisma.user.findUniqueOrThrow({ where: { phone: SEED.guestPhone } })).id;
    await ctx.prisma.pushDevice.deleteMany({ where: { token: { in: [GOOD, GONE, OWNER] } } });
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { notificationSettings: { customerOrderUpdates: true, channel: 'SMS', fallbackToSms: true } },
    });
  });

  afterAll(async () => {
    await ctx.prisma.pushDevice.deleteMany({ where: { token: { in: [GOOD, GONE, OWNER] } } });
    for (const id of created) {
      await ctx.prisma.deliveryStop.deleteMany({ where: { orderId: id } });
      await ctx.prisma.order.delete({ where: { id } }).catch(() => undefined);
    }
    await ctx.close();
  });

  it('registers a device for the signed-in person and refuses foreign tokens', async () => {
    await ctx
      .http()
      .post('/me/devices')
      .set(bearer(guestToken))
      .send({ platform: 'IOS', token: 'fcm:abc' })
      .expect(400);
    const res = await ctx
      .http()
      .post('/me/devices')
      .set(bearer(guestToken))
      .send({ platform: 'IOS', token: GOOD, appVersion: '0.1.0', locale: 'tr' })
      .expect(201);
    expect(res.body.tokenTail).toBe('...e-0001]');
    expect(res.body.platform).toBe('IOS');
    const list = await ctx.http().get('/me/devices').set(bearer(guestToken)).expect(200);
    expect(list.body.map((d: { tokenTail: string }) => d.tokenTail)).toContain('...e-0001]');
    // The same token registering under another account follows that account.
    await ctx.http().post('/me/devices').set(bearer(ownerToken)).send({ platform: 'ANDROID', token: GOOD }).expect(201);
    expect((await ctx.prisma.pushDevice.findUniqueOrThrow({ where: { token: GOOD } })).userId).not.toBe(guestUserId);
    await ctx.http().post('/me/devices').set(bearer(guestToken)).send({ platform: 'IOS', token: GOOD }).expect(201);
    expect((await ctx.prisma.pushDevice.findUniqueOrThrow({ where: { token: GOOD } })).userId).toBe(guestUserId);
  });

  it('pushes the customer and the staff; a delivered push spares the paid message', async () => {
    await ctx
      .http()
      .post('/me/devices')
      .set(bearer(ownerToken))
      .send({ platform: 'ANDROID', token: OWNER })
      .expect(201);
    const smsBefore = await smsLogs('order.accepted');
    const order = await placeAsGuest();
    expect(order.customerUserId).toBe(guestUserId);

    const placed = await pushLogs('order.placed');
    expect(placed[0]?.status).toBe('SENT');
    expect(placed[0]?.toMasked).toBe('...e-0003]');
    expect(placed[0]?.creditsCharged).toBe(0);

    await transition(order.id, 'ACCEPTED', { prepMinutes: 20 });
    const accepted = await pushLogs('order.accepted');
    expect(accepted[0]?.status).toBe('SENT');
    expect(accepted[0]?.toMasked).toBe('...e-0001]');
    expect(await smsLogs('order.accepted')).toBe(smsBefore);
  });

  it('falls back to the paid message and disables the device when the service reports it gone', async () => {
    await ctx
      .http()
      .delete(`/me/devices/${encodeURIComponent(GOOD)}`)
      .set(bearer(guestToken))
      .expect(204);
    await ctx.http().post('/me/devices').set(bearer(guestToken)).send({ platform: 'ANDROID', token: GONE }).expect(201);
    const smsAcceptedBefore = await smsLogs('order.accepted');
    const smsCancelledBefore = await smsLogs('order.cancelled');
    const order = await placeAsGuest();
    await transition(order.id, 'ACCEPTED', { prepMinutes: 15 });

    const accepted = await pushLogs('order.accepted');
    expect(accepted[0]?.status).toBe('FAILED');
    expect(accepted[0]?.errorCode).toBe('DEVICE_GONE');
    expect(accepted[0]?.toMasked).toBe('...e-0002]');
    expect((await ctx.prisma.pushDevice.findUniqueOrThrow({ where: { token: GONE } })).disabledAt).not.toBeNull();
    // The paid message went out instead.
    expect(await smsLogs('order.accepted')).toBe(smsAcceptedBefore + 1);

    // A disabled device is not listed and is not tried again: the next update goes straight to the paid channel.
    await transition(order.id, 'CANCELLED_BY_RESTAURANT', { reason: 'Malzeme bitti' });
    expect(await pushLogs('order.cancelled')).toHaveLength(0);
    expect(await smsLogs('order.cancelled')).toBe(smsCancelledBefore + 1);
    const list = await ctx.http().get('/me/devices').set(bearer(guestToken)).expect(200);
    expect(list.body).toHaveLength(0);
  });
});
