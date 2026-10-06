import { createHmac } from 'node:crypto';
import type { CourierNetworkStatusDTO, OrderDetailDTO, OrderTrackingDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const NOTE = 'e2e-courier-requests';
const SECRET = 'mock-courier-secret';

/** Calling a courier network for an order and following its signed events (docs/KURYE.md). */
describe('Courier network requests (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let itemId: string;
  const owner = () => bearer(ownerToken);

  const order = async (name: string, fulfillment: 'DELIVERY' | 'PICKUP' = 'DELIVERY') => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment,
        items: [{ menuItemId: itemId, quantity: 1 }],
        ...(fulfillment === 'DELIVERY'
          ? {
              address: {
                addressLine: `${name} Sok. No 8`,
                city: 'Istanbul',
                district: 'Kadikoy',
                contactName: name,
                contactPhone: '0532 999 06 06',
                point: { lat: 40.99, lng: 29.03 },
              },
              deliveryFeeMinor: 1500,
            }
          : { customer: { fullName: name, phone: '0532 999 06 07' } }),
        note: NOTE,
      })
      .expect(201);
    return res.body as OrderDetailDTO & { trackingUrl: string };
  };
  const transition = (id: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${id}/transition`)
      .set(owner())
      .send({ to, ...extra })
      .expect(200);
  const call = (id: string, status = 200) =>
    ctx.http().post(`/restaurants/${restaurantId}/orders/${id}/courier-request`).set(owner()).expect(status);
  const cancel = (id: string, status = 200) =>
    ctx.http().post(`/restaurants/${restaurantId}/orders/${id}/courier-request/cancel`).set(owner()).expect(status);
  const event = (payload: Record<string, unknown>, secret = SECRET, status = 200) => {
    const body = JSON.stringify({ occurredAt: new Date().toISOString(), ...payload });
    return ctx
      .http()
      .post('/webhooks/courier/MOCK')
      .set('content-type', 'application/json')
      .set('x-mock-signature', createHmac('sha256', secret).update(body).digest('hex'))
      .send(body)
      .expect(status);
  };
  const statusOf = async (id: string) =>
    (await ctx.prisma.order.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

  beforeAll(async () => {
    ctx = await createTestApp();
    ownerToken = await ctx.login(SEED.ownerPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true, menuItems: true },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    itemId = restaurant.menuItems.find((m) => m.name === 'Izgara kofte')!.id;
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
  });

  afterAll(async () => {
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.close();
  });

  it("offers the restaurant's network and refuses orders that cannot take a courier", async () => {
    const network = (await ctx.http().get(`/restaurants/${restaurantId}/courier/network`).set(owner()).expect(200))
      .body as CourierNetworkStatusDTO;
    expect(network).toEqual({ available: true, providerName: 'Mock courier network' });
    const placed = await order('Kurye Bekleyen');
    expect((await call(placed.id, 409)).headers['x-error-code']).toBe('COURIER_REQUEST_NOT_ALLOWED');
    const pickup = await order('Gel Al', 'PICKUP');
    await transition(pickup.id, 'ACCEPTED', { prepMinutes: 10 });
    await call(pickup.id, 409);
  });

  it('calls a courier while cooking and lets the network carry the order to the door', async () => {
    const created = await order('Ag Teslim');
    await transition(created.id, 'ACCEPTED', { prepMinutes: 10 });
    const called = (await call(created.id)).body as OrderDetailDTO;
    expect(called.courierRequest).toMatchObject({
      status: 'REQUESTED',
      providerName: 'Mock courier network',
      providerRef: `mock-${created.id}`,
      currency: created.currency,
    });
    expect(called.courierRequest!.quoteFeeMinor).toBeGreaterThan(0);
    expect((await call(created.id, 409)).headers['x-error-code']).toBe('COURIER_REQUEST_NOT_ALLOWED');

    const ref = `mock-${created.id}`;
    await event({ providerRef: ref, kind: 'ASSIGNED' }, 'wrong-secret-wrong-secret', 400);
    expect((await event({ providerRef: 'mock-unknown', kind: 'ASSIGNED' })).body.status).toBe('IGNORED');
    expect((await event({ providerRef: ref, kind: 'ASSIGNED' })).body.status).toBe('ASSIGNED');
    // Still cooking: an assignment leaves the order in the kitchen.
    expect(await statusOf(created.id)).toBe('ACCEPTED');

    const token = created.trackingUrl.split('/t/')[1];
    const tracking = (await ctx.http().get(`/public/orders/${token}`).expect(200)).body as OrderTrackingDTO;
    expect(tracking.courierNetwork).toEqual({ name: 'Mock courier network', trackingUrl: null });

    await event({ providerRef: ref, kind: 'PICKED_UP' });
    expect(await statusOf(created.id)).toBe('OUT_FOR_DELIVERY');
    // An older event after the pickup changes nothing.
    expect((await event({ providerRef: ref, kind: 'ASSIGNED' })).body.status).toBe('IGNORED');
    await event({ providerRef: ref, kind: 'DELIVERED', finalFeeMinor: 4200 });
    expect(await statusOf(created.id)).toBe('DELIVERED');
    const history = await ctx.prisma.orderStatusHistory.findMany({
      where: { orderId: created.id },
      orderBy: { createdAt: 'asc' },
      select: { toStatus: true },
    });
    expect(history.map((h) => h.toStatus).slice(-4)).toEqual([
      'READY',
      'HANDED_TO_COURIER',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ]);
    expect(await ctx.prisma.deliveryRequest.findUniqueOrThrow({ where: { orderId: created.id } })).toMatchObject({
      status: 'DELIVERED',
      finalFeeMinor: 4200,
    });
    const after = (await ctx.http().get(`/public/orders/${token}`).expect(200)).body as OrderTrackingDTO;
    expect(after.courierNetwork).toBeNull();
  });

  it('cancels a call, calls again on the same request and brings a failed delivery back to ready', async () => {
    const created = await order('Ag Iptal');
    await transition(created.id, 'ACCEPTED', { prepMinutes: 10 });
    await transition(created.id, 'READY');
    await call(created.id);
    await event({ providerRef: `mock-${created.id}`, kind: 'ASSIGNED' });
    expect(await statusOf(created.id)).toBe('HANDED_TO_COURIER');
    const cancelled = (await cancel(created.id)).body as OrderDetailDTO;
    expect(cancelled.courierRequest?.status).toBe('CANCELLED');
    expect(cancelled.status).toBe('READY');
    await cancel(created.id, 409);

    const again = (await call(created.id)).body as OrderDetailDTO;
    expect(again.courierRequest?.status).toBe('REQUESTED');
    expect(await ctx.prisma.deliveryRequest.count({ where: { orderId: created.id } })).toBe(1);
    await event({ providerRef: `mock-${created.id}`, kind: 'PICKED_UP' });
    await cancel(created.id, 409);
    await event({ providerRef: `mock-${created.id}`, kind: 'FAILED', reason: 'Adres bulunamadi' });
    expect(await statusOf(created.id)).toBe('READY');
    expect(await ctx.prisma.deliveryRequest.findUniqueOrThrow({ where: { orderId: created.id } })).toMatchObject({
      status: 'FAILED',
      failureReason: 'Adres bulunamadi',
    });
  });

  it('calls the courier off when the restaurant cancels the order', async () => {
    const created = await order('Ag Siparis Iptal');
    await transition(created.id, 'ACCEPTED', { prepMinutes: 10 });
    await call(created.id);
    await transition(created.id, 'CANCELLED_BY_RESTAURANT', { reason: 'Malzeme bitti' });
    // The listener runs after the order is published.
    let status = '';
    for (let i = 0; i < 20 && status !== 'CANCELLED'; i++) {
      status = (await ctx.prisma.deliveryRequest.findUniqueOrThrow({ where: { orderId: created.id } })).status;
      if (status !== 'CANCELLED') await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(status).toBe('CANCELLED');
  });
});
