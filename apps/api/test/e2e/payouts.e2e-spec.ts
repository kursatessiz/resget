import { PaymentMode } from '@resget/database';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Ledger lines per completed order and weekly payouts (docs/MUTABAKAT.md). */
describe('Ledger and payouts (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let menuItemId: string;
  let originalMode: PaymentMode;
  const orderIds: string[] = [];
  const payoutIds: string[] = [];

  const staffOrder = async (payment?: Record<string, unknown>) => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken))
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity: 2 }],
        customer: { fullName: 'Defter Musteri', phone: '0532 999 09 31' },
        ...(payment ? { payment } : {}),
      })
      .expect(201);
    orderIds.push(res.body.id as string);
    return res.body as { id: string; restaurantPayableMinor?: number; status: string };
  };
  const transition = (id: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${id}/transition`)
      .set(bearer(ownerToken))
      .send({ to, ...extra })
      .expect(200);
  const complete = async (id: string) => {
    await transition(id, 'ACCEPTED', { prepMinutes: 5 });
    await transition(id, 'READY');
    await transition(id, 'PICKED_UP');
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login(SEED.superAdminPhone);
    ownerToken = await ctx.login(SEED.ownerPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, paymentMode: true, branches: { take: 1, select: { id: true } } },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    originalMode = restaurant.paymentMode;
    menuItemId = (
      await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, isAvailable: true }, select: { id: true } })
    ).id;
    await ctx.prisma.ledgerEntry.deleteMany({ where: { restaurantId, orderId: { not: null } } });
    await ctx.prisma.payout.deleteMany({ where: { restaurantId } });
  });

  afterAll(async () => {
    await ctx.prisma.ledgerEntry.deleteMany({
      where: { OR: [{ orderId: { in: orderIds } }, { payoutId: { in: payoutIds } }] },
    });
    await ctx.prisma.payout.deleteMany({ where: { restaurantId } });
    await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: originalMode } });
    await ctx.close();
  });

  it('writes the statement of a completed PLATFORM_PSP order once, and nothing for OWN_POS money', async () => {
    const cash = await staffOrder({ method: 'CASH_ON_DELIVERY' });
    await complete(cash.id);
    expect(await ctx.prisma.ledgerEntry.count({ where: { orderId: cash.id } })).toBe(0);

    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/mode`)
      .set(bearer(ownerToken))
      .send({ paymentMode: 'PLATFORM_PSP' })
      .expect(200);
    const platform = await staffOrder();
    const snapshot = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: platform.id },
      select: { paymentMode: true, restaurantPayableMinor: true },
    });
    expect(snapshot.paymentMode).toBe('PLATFORM_PSP');
    await complete(platform.id);
    const lines = await ctx.prisma.ledgerEntry.findMany({ where: { orderId: platform.id }, orderBy: { type: 'asc' } });
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const payable = lines.find((l) => l.type === 'RESTAURANT_PAYABLE');
    expect(payable?.amountMinor).toBe(snapshot.restaurantPayableMinor);
    const others = lines.filter((l) => l.type !== 'RESTAURANT_PAYABLE').reduce((n, l) => n + l.amountMinor, 0);
    expect(others).toBe(snapshot.restaurantPayableMinor);
    expect(lines.every((l) => l.payoutId === null && l.invoiceId === null)).toBe(true);
    // Completing is final; a second write never happens.
    expect(await ctx.prisma.ledgerEntry.count({ where: { orderId: platform.id } })).toBe(lines.length);

    const ledger = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/finance/ledger`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(ledger.body.paymentMode).toBe('PLATFORM_PSP');
    expect(ledger.body.pendingPayableMinor).toBe(snapshot.restaurantPayableMinor);
    expect(ledger.body.entries.some((e: { orderId: string }) => e.orderId === platform.id)).toBe(true);
  });

  it('rolls the closed week into one payout within the legal window and marks the transfer', async () => {
    const pending = await ctx.prisma.ledgerEntry.aggregate({
      where: {
        restaurantId,
        payoutId: null,
        invoiceId: null,
        type: { in: ['RESTAURANT_PAYABLE', 'REFUND', 'ADJUSTMENT'] },
      },
      _sum: { amountMinor: true },
    });
    const expected = pending._sum.amountMinor ?? 0;
    expect(expected).toBeGreaterThan(0);
    // "Next Wednesday": the week holding today's orders is closed by then.
    const asOf = new Date();
    asOf.setUTCDate(asOf.getUTCDate() + 7);
    const run = await ctx
      .http()
      .post('/admin/payouts/run')
      .set(bearer(adminToken))
      .send({ asOf: asOf.toISOString() })
      .expect(200);
    expect(run.body.created).toBeGreaterThanOrEqual(1);
    const list = await ctx.http().get('/admin/payouts?status=SCHEDULED').set(bearer(adminToken)).expect(200);
    const payout = list.body.items.find((p: { restaurant: { id: string } }) => p.restaurant.id === restaurantId);
    expect(payout).toBeDefined();
    payoutIds.push(payout.id);
    expect(payout.amountMinor).toBe(expected);
    expect(payout.currency).toBe('TRY');
    // Turkey: five business days after the week closes (periodEnd is a Monday, so the following Monday).
    const periodEnd = new Date(payout.periodEnd);
    const scheduledFor = new Date(payout.scheduledFor);
    expect((scheduledFor.getTime() - periodEnd.getTime()) / 86_400_000).toBe(7);
    expect(payout.entryCount).toBeGreaterThanOrEqual(1);

    const again = await ctx
      .http()
      .post('/admin/payouts/run')
      .set(bearer(adminToken))
      .send({ asOf: asOf.toISOString() })
      .expect(200);
    expect(again.body.created).toBe(0);
    const ledger = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/finance/ledger`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(ledger.body.pendingPayableMinor).toBe(0);
    expect(ledger.body.payouts[0]).toMatchObject({ id: payout.id, status: 'SCHEDULED', amountMinor: expected });

    await ctx.http().post(`/admin/payouts/${payout.id}/settled`).set(bearer(adminToken)).send({}).expect(409);
    const sent = await ctx
      .http()
      .post(`/admin/payouts/${payout.id}/sent`)
      .set(bearer(adminToken))
      .send({ providerRef: 'EFT-2026-001' })
      .expect(200);
    expect(sent.body).toMatchObject({ status: 'SENT', providerRef: 'EFT-2026-001' });
    const settled = await ctx
      .http()
      .post(`/admin/payouts/${payout.id}/settled`)
      .set(bearer(adminToken))
      .send({})
      .expect(200);
    expect(settled.body.status).toBe('SETTLED');
    await ctx
      .http()
      .post(`/admin/payouts/${payout.id}/failed`)
      .set(bearer(adminToken))
      .send({ reason: 'late' })
      .expect(409);
    await ctx.http().get('/admin/payouts').set(bearer(ownerToken)).expect(403);
  });
});
