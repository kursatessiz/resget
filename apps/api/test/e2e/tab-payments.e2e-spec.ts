import { createHmac } from 'node:crypto';
import type { PaymentMode } from '@resget/database';
import type { OrderDetailDTO, TabBillDTO, TabPaymentStartedDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const NOTE = 'e2e-tab-payments';
const MERCHANT = 'merchant-tabpay';

/** A guest pays a share of the open tab by card on the restaurant's POS (docs/ACIK_HESAP.md). */
describe('Open tab online share (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let tableId: string;
  let itemId: string;
  let connectionId: string;
  let token: string;
  let tabId: string;
  let originalMode: PaymentMode;
  const owner = () => bearer(ownerToken);

  const waiterOrder = async (quantity: number) =>
    (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/orders`)
        .set(owner())
        .send({
          branchId,
          channel: 'TABLE_QR',
          fulfillment: 'DINE_IN',
          tableId,
          tab: true,
          items: [{ menuItemId: itemId, quantity }],
          note: NOTE,
        })
        .expect(201)
    ).body as OrderDetailDTO;
  const publicBill = async () => (await ctx.http().get(`/public/tabs/${token}`).expect(200)).body as TabBillDTO;
  const pay = (amountMinor: number, status = 200) =>
    ctx
      .http()
      .post(`/public/tabs/${token}/pay`)
      .send({ amountMinor, returnUrl: `https://app.example.com/hesap/${token}` })
      .expect(status);
  const notice = (payload: Record<string, unknown>) => {
    const body = JSON.stringify({ currency: 'TRY', pspFeeMinor: 0, occurredAt: new Date().toISOString(), ...payload });
    return ctx
      .http()
      .post(`/webhooks/payments/pos/${connectionId}`)
      .set('content-type', 'application/json')
      .set('x-mock-signature', createHmac('sha256', MERCHANT).update(body).digest('hex'))
      .send(body)
      .expect(200);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { menuItems: true, tables: true },
    });
    restaurantId = restaurant.id;
    originalMode = restaurant.paymentMode;
    const table = restaurant.tables.find((t) => t.isActive)!;
    tableId = table.id;
    branchId = table.branchId;
    itemId = restaurant.menuItems.find((m) => m.name === 'Izgara kofte')!.id;
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.tableTab.deleteMany({ where: { tableId } });
    await ctx.prisma.paymentProviderConnection.deleteMany({ where: { restaurantId } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/table_tabs`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
  });

  afterAll(async () => {
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.tableTab.deleteMany({ where: { tableId } });
    await ctx.prisma.paymentProviderConnection.deleteMany({ where: { restaurantId } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'table_tabs' } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: originalMode } });
    await ctx.close();
  });

  it("is offered only on the restaurant's own POS", async () => {
    const first = await waiterOrder(2);
    await waiterOrder(1);
    tabId = first.tabId!;
    token = (await ctx.prisma.tableTab.findUniqueOrThrow({ where: { id: tabId } })).publicToken;
    expect((await publicBill()).payOnline).toBe(false);
    expect((await pay(1000, 409)).headers['x-error-code']).toBe('PAYMENT_METHOD_NOT_ACCEPTED');

    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/connection`)
      .set(owner())
      .send({ providerCode: 'MOCK', credentials: { merchantId: MERCHANT } })
      .expect(200);
    connectionId = (await ctx.prisma.paymentProviderConnection.findUniqueOrThrow({ where: { restaurantId } })).id;
    expect((await publicBill()).payOnline).toBe(true);

    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'PLATFORM_PSP' } });
    expect((await publicBill()).payOnline).toBe(false);
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
  });

  it('spreads a captured share over the orders as POS card payments, once', async () => {
    const before = await publicBill();
    expect((await pay(before.dueMinor + 1, 409)).headers['x-error-code']).toBe('PAYMENT_STATE_INVALID');
    const share = Math.floor(before.dueMinor / 2);
    const started = (await pay(share)).body as TabPaymentStartedDTO;
    expect(started.session.redirectUrl).toContain(`/hesap/${token}`);
    // Not paid until the POS says so.
    expect((await publicBill()).paidMinor).toBe(before.paidMinor);

    await notice({ providerRef: 'tab-pay-1', orderRef: started.paymentId, status: 'CAPTURED', amountMinor: share });
    await notice({ providerRef: 'tab-pay-1', orderRef: started.paymentId, status: 'CAPTURED', amountMinor: share });
    const after = await publicBill();
    expect(after.paidMinor).toBe(before.paidMinor + share);
    expect(after.dueMinor).toBe(before.dueMinor - share);
    const payments = await ctx.prisma.payment.findMany({
      where: { order: { tabId }, method: 'ONLINE_CARD' },
      orderBy: { createdAt: 'asc' },
    });
    expect(payments.reduce((sum, p) => sum + p.amountMinor, 0)).toBe(share);
    expect(payments.every((p) => p.status === 'CAPTURED' && p.paymentMode === 'OWN_POS')).toBe(true);
    expect(payments.every((p) => p.provider === 'MOCK' && p.providerRef === 'tab-pay-1')).toBe(true);
    expect(await ctx.prisma.tabPayment.findUniqueOrThrow({ where: { id: started.paymentId } })).toMatchObject({
      status: 'CAPTURED',
      excessMinor: 0,
    });
  });

  it('gives back what the counter collected while the guest was paying', async () => {
    const due = (await publicBill()).dueMinor;
    const started = (await pay(due)).body as TabPaymentStartedDTO;
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/tabs/${tabId}/collect`)
      .set(owner())
      .send({ method: 'CASH_ON_DELIVERY', amountMinor: 500 })
      .expect(200);
    await notice({ providerRef: 'tab-pay-2', orderRef: started.paymentId, status: 'CAPTURED', amountMinor: due });
    expect((await publicBill()).dueMinor).toBe(0);
    const row = await ctx.prisma.tabPayment.findUniqueOrThrow({ where: { id: started.paymentId } });
    expect(row).toMatchObject({ status: 'CAPTURED', excessMinor: 500 });
    expect(row.excessRefundedAt).not.toBeNull();
    expect((await pay(100, 409)).headers['x-error-code']).toBe('PAYMENT_STATE_INVALID');
  });
});
