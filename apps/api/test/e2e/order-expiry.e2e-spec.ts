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
});
