import { Prisma } from '@resget/database';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { OrdersWatchdog } from '../../src/modules/orders/orders.watchdog';

/** Acceptance timeout (docs/SIPARIS_VE_SEVK.md): deadline on placement, one alarm, cleared on acceptance. */
describe('Order acceptance timeout (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let menuItemId: string;
  const orderIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
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
  });

  afterAll(async () => {
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.close();
  });

  const createOrder = async () => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken))
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'DELIVERY',
        items: [{ menuItemId, quantity: 1 }],
        address: {
          addressLine: 'Timeout Sok. No 3',
          city: 'Istanbul',
          district: 'Kadikoy',
          contactName: 'Zaman Asimi',
          contactPhone: '0532 999 09 12',
          point: { lat: 40.99, lng: 29.03 },
        },
        deliveryFeeMinor: 0,
      })
      .expect(201);
    orderIds.push(res.body.id as string);
    return res.body as { id: string; placedAt: string; acceptDeadlineAt: string | null; status: string };
  };

  it('gives a new order the restaurant acceptance window and clears it on acceptance', async () => {
    const order = await createOrder();
    expect(order.status).toBe('PLACED');
    expect(order.acceptDeadlineAt).not.toBeNull();
    // Seeded dispatch settings carry no override, so the default of 10 minutes applies.
    expect(new Date(order.acceptDeadlineAt!).getTime() - new Date(order.placedAt).getTime()).toBe(10 * 60_000);
    const accepted = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${order.id}/transition`)
      .set(bearer(ownerToken))
      .send({ to: 'ACCEPTED', prepMinutes: 15 })
      .expect(200);
    expect(accepted.body.acceptDeadlineAt).toBeNull();
    const row = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { acceptDeadlineAt: true },
    });
    expect(row.acceptDeadlineAt).toBeNull();
  });

  it('the watchdog alarms an overdue order once and messages the owner on the platform account', async () => {
    const order = await createOrder();
    await ctx.prisma.order.update({
      where: { id: order.id },
      data: { acceptDeadlineAt: new Date(Date.now() - 60_000) },
    });
    const watchdog = ctx.app.get(OrdersWatchdog);
    const first = await watchdog.tick(new Date());
    expect(first).toBeGreaterThanOrEqual(1);
    const stamped = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { acceptAlertSentAt: true, status: true },
    });
    expect(stamped.acceptAlertSentAt).not.toBeNull();
    expect(stamped.status).toBe('PLACED');
    const logs = await ctx.prisma.messageLog.findMany({
      where: { restaurantId, templateKey: 'order.acceptOverdue', createdAt: { gte: new Date(Date.now() - 60_000) } },
      select: { status: true, creditsCharged: true },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.every((l) => l.creditsCharged === 0)).toBe(true);

    const second = await watchdog.tick(new Date());
    const again = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { acceptAlertSentAt: true },
    });
    expect(again.acceptAlertSentAt?.getTime()).toBe(stamped.acceptAlertSentAt?.getTime());
    expect(second).toBe(0);

    const listed = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/orders?active=true`)
      .set(bearer(ownerToken))
      .expect(200);
    const shown = listed.body.find((o: { id: string }) => o.id === order.id);
    expect(new Date(shown.acceptDeadlineAt).getTime()).toBeLessThan(Date.now());
  });

  it('the acceptance window is a restaurant setting', async () => {
    const before = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { dispatchSettings: true },
    });
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}`)
      .set(bearer(ownerToken))
      .send({ dispatchSettings: { acceptTimeoutMinutes: 4 } })
      .expect(200);
    const order = await createOrder();
    expect(new Date(order.acceptDeadlineAt!).getTime() - new Date(order.placedAt).getTime()).toBe(4 * 60_000);
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { dispatchSettings: before.dispatchSettings === null ? Prisma.DbNull : before.dispatchSettings },
    });
  });
});
