import { PENDING_PAYMENT_TIMEOUT_MINUTES } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { OrdersService } from '../../src/modules/orders/orders.service';

const NOTE = 'e2e-expiry';

/** An online order whose payment never completes is cancelled and gives its stock back (docs/ODEME.md). */
describe('Unpaid order expiry (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let branchId: string;
  let itemId: string;
  let ownerToken: string;
  let adminToken: string;
  let originalStock: number | null;

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true, menuItems: true },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    const item = restaurant.menuItems.find((m) => m.isAvailable)!;
    itemId = item.id;
    originalStock = item.stockQuantity;
    await ctx.prisma.menuItem.update({ where: { id: itemId }, data: { stockQuantity: 10 } });
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.paymentProviderConnection.deleteMany({ where: { restaurantId } });
    ownerToken = await ctx.login(SEED.ownerPhone);
    // Stock counts are a module of their own (docs/STOK.md); on for this scenario only.
    adminToken = await ctx.login(SEED.superAdminPhone);
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/menu_stock`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/connection`)
      .set(bearer(ownerToken))
      .send({ providerCode: 'MOCK', credentials: { merchantId: 'merchant-expiry' } })
      .expect(200);
  });

  afterAll(async () => {
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/menu_stock`)
      .set(bearer(adminToken))
      .send({ enabled: null })
      .expect(200);
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.paymentProviderConnection.deleteMany({ where: { restaurantId } });
    await ctx.prisma.menuItem.update({ where: { id: itemId }, data: { stockQuantity: originalStock } });
    await ctx.close();
  });

  it('cancels an online order left unpaid past the timeout and releases its stock, and keeps a fresh one', async () => {
    const place = async () =>
      (
        await ctx
          .http()
          .post(`/restaurants/${restaurantId}/orders`)
          .set(bearer(ownerToken))
          .send({
            branchId,
            channel: 'PHONE',
            fulfillment: 'PICKUP',
            items: [{ menuItemId: itemId, quantity: 2 }],
            customer: { fullName: 'Odemesiz Musteri', phone: '0532 999 09 51' },
            note: NOTE,
            payment: { method: 'ONLINE_CARD' },
          })
          .expect(201)
      ).body as { id: string; status: string };
    const stale = await place();
    const fresh = await place();
    expect(stale.status).toBe('PENDING_PAYMENT');
    expect((await ctx.prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } })).stockQuantity).toBe(6);
    await ctx.prisma.order.update({
      where: { id: stale.id },
      data: { createdAt: new Date(Date.now() - (PENDING_PAYMENT_TIMEOUT_MINUTES + 1) * 60_000) },
    });

    const expired = await ctx.app.get(OrdersService).expireUnpaid();
    expect(expired).toBeGreaterThanOrEqual(1);
    const staleRow = await ctx.prisma.order.findUniqueOrThrow({ where: { id: stale.id } });
    expect(staleRow.status).toBe('CANCELLED_BY_CUSTOMER');
    expect(staleRow.rejectReason).toBe('payment not completed');
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('PENDING_PAYMENT');
    expect((await ctx.prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } })).stockQuantity).toBe(8);
    // A second pass finds nothing more to do.
    await ctx.app.get(OrdersService).expireUnpaid();
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe(
      'CANCELLED_BY_CUSTOMER',
    );
  });

  it('lets the restaurant cancel an order waiting for its payment, with stock back and the counters rebuilt', async () => {
    const phone = '0532 999 09 52';
    const place = async (method: 'ONLINE_CARD' | 'CASH_ON_DELIVERY') =>
      (
        await ctx
          .http()
          .post(`/restaurants/${restaurantId}/orders`)
          .set(bearer(ownerToken))
          .send({
            branchId,
            channel: 'PHONE',
            fulfillment: 'PICKUP',
            items: [{ menuItemId: itemId, quantity: 1 }],
            customer: { fullName: 'Iptal Sayac', phone },
            note: NOTE,
            payment: { method },
          })
          .expect(201)
      ).body as { id: string; status: string };
    const user = async () => ctx.prisma.user.findUniqueOrThrow({ where: { phone: '+905329990952' } });
    const counters = async () =>
      ctx.prisma.restaurantCustomer.findUniqueOrThrow({
        where: { restaurantId_userId: { restaurantId, userId: (await user()).id } },
        select: { orderCount: true, lifetimeGrossMinor: true, lastOrderAt: true },
      });

    // Earlier runs deleted their orders but not this customer's row; start from a clean one.
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { restaurantId, user: { phone: '+905329990952' } } });
    const kept = await place('CASH_ON_DELIVERY');
    const keptGross = (await ctx.prisma.order.findUniqueOrThrow({ where: { id: kept.id } })).itemsGrossMinor;
    const before = await counters();
    const unpaid = await place('ONLINE_CARD');
    expect(unpaid.status).toBe('PENDING_PAYMENT');
    expect((await counters()).orderCount).toBe(before.orderCount + 1);
    const stockBefore = (await ctx.prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } })).stockQuantity!;

    // Only the restaurant's cancellation is offered; acceptance waits for the payment.
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${unpaid.id}/transition`)
      .set(bearer(ownerToken))
      .send({ to: 'ACCEPTED', prepMinutes: 15 })
      .expect(409);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${unpaid.id}/transition`)
      .set(bearer(ownerToken))
      .send({ to: 'CANCELLED_BY_RESTAURANT', reason: 'customer called to cancel' })
      .expect(200);

    const row = await ctx.prisma.order.findUniqueOrThrow({ where: { id: unpaid.id } });
    expect(row.status).toBe('CANCELLED_BY_RESTAURANT');
    expect(row.rejectReason).toBe('customer called to cancel');
    expect((await ctx.prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } })).stockQuantity).toBe(
      stockBefore + 1,
    );
    // The cancelled order is out of every counter; the kept one is still there.
    const after = await counters();
    expect(after.orderCount).toBe(before.orderCount);
    expect(after.lifetimeGrossMinor).toBe(before.lifetimeGrossMinor);
    expect(after.lastOrderAt?.getTime()).toBe(before.lastOrderAt?.getTime());
    expect(after.lifetimeGrossMinor).toBeGreaterThanOrEqual(keptGross);

    // Cancelling the kept order empties the counters; the customer row stays for the books.
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${kept.id}/transition`)
      .set(bearer(ownerToken))
      .send({ to: 'REJECTED', reason: 'closed' })
      .expect(200);
    const others = await ctx.prisma.order.count({
      where: {
        restaurantId,
        customerUserId: (await user()).id,
        status: { notIn: ['REJECTED', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_CUSTOMER'] },
      },
    });
    expect((await counters()).orderCount).toBe(others);
  });
});
