import type { OrderDetailDTO, StorefrontDTO, TabBillDTO, TabSummaryDTO } from '@resget/shared';
import { splitEqual } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const NOTE = 'e2e-tabs';

/** Open tab at the table: orders on the tab, shares collected at the counter, closing (docs/ACIK_HESAP.md). */
describe('Open tab (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let tableId: string;
  let tableToken: string;
  let itemId: string;
  let startedAt: Date;
  const client = `10.82.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
  const owner = () => bearer(ownerToken);

  const guestOrder = (body: Record<string, unknown>, status = 201) =>
    ctx
      .http()
      .post(`/public/qr/${tableToken}/orders`)
      .set('x-forwarded-for', client)
      .send({ fulfillment: 'DINE_IN', items: [{ menuItemId: itemId, quantity: 2 }], note: NOTE, ...body })
      .expect(status);
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
  const bill = async (tabId: string) =>
    (await ctx.http().get(`/restaurants/${restaurantId}/tabs/${tabId}`).set(owner()).expect(200)).body as TabBillDTO;
  const collect = (tabId: string, amountMinor: number, status = 200) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/tabs/${tabId}/collect`)
      .set(owner())
      .send({ method: 'CASH_ON_DELIVERY', amountMinor })
      .expect(status);
  const serve = async (orderId: string) => {
    for (const step of [{ to: 'ACCEPTED', prepMinutes: 10 }, { to: 'READY' }, { to: 'DELIVERED' }]) {
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/orders/${orderId}/transition`)
        .set(owner())
        .send(step)
        .expect(200);
    }
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    startedAt = new Date();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { menuItems: true, tables: true },
    });
    restaurantId = restaurant.id;
    const table = restaurant.tables.find((t) => t.isActive)!;
    tableId = table.id;
    branchId = table.branchId;
    tableToken = table.qrToken;
    itemId = restaurant.menuItems.find((m) => m.name === 'Izgara kofte')!.id;
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.tabPayment.deleteMany({ where: { tab: { tableId } } });
    await ctx.prisma.tableTab.deleteMany({ where: { tableId } });
  });

  afterAll(async () => {
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.tabPayment.deleteMany({ where: { tab: { restaurantId, createdAt: { gte: startedAt } } } });
    await ctx.prisma.tableTab.deleteMany({ where: { restaurantId, createdAt: { gte: startedAt } } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'table_tabs' } });
    await ctx.close();
  });

  it('is off by default', async () => {
    const page = (await ctx.http().get(`/public/qr/${tableToken}`).expect(200)).body as StorefrontDTO;
    expect(page.tab).toEqual({ enabled: false, open: null });
    const res = await guestOrder({ tab: true }, 403);
    expect(res.headers['x-error-code']).toBe('FEATURE_DISABLED');
  });

  it('refuses a tab order that also names a payment or is not at the table', async () => {
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/table_tabs`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    await guestOrder({ tab: true, payment: { method: 'CASH_ON_DELIVERY' } }, 400);
    await guestOrder({}, 400);
    await guestOrder(
      { tab: true, fulfillment: 'PICKUP', customer: { fullName: 'Masa Musteri', phone: '05329990996' } },
      400,
    );
  });

  it('gathers the table orders on one tab and shows the bill without personal data', async () => {
    const first = await guestOrder({ tab: true, customer: { fullName: 'Masa Musteri', phone: '05329990996' } });
    expect(first.body.status).toBe('PLACED');
    expect(first.body.checkoutUrl).toBeNull();
    expect(first.body.tabUrl).toMatch(/\/hesap\/[A-Za-z0-9_-]{24}$/);
    const waiter = await waiterOrder(1);
    const firstRow = await ctx.prisma.order.findFirstOrThrow({ where: { trackingToken: first.body.trackingToken } });
    expect(waiter.tabId).toBe(firstRow.tabId);
    expect(firstRow.paymentMode).toBe('OWN_POS');
    expect(firstRow.platformReceivableMinor).toBe(0);

    const page = (await ctx.http().get(`/public/qr/${tableToken}`).expect(200)).body as StorefrontDTO;
    const total = firstRow.chargedToCustomerMinor + waiter.chargedToCustomerMinor;
    expect(page.tab?.enabled).toBe(true);
    expect(page.tab?.open).toMatchObject({ totalMinor: total, dueMinor: total });

    const token = String(first.body.tabUrl).split('/hesap/')[1];
    const res = await ctx.http().get(`/public/tabs/${token}`).expect(200);
    const publicBill = res.body as TabBillDTO;
    expect(publicBill).toMatchObject({ status: 'OPEN', totalMinor: total, paidMinor: 0, dueMinor: total });
    expect(publicBill.lines).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toContain('05329990996');
    expect(JSON.stringify(res.body)).not.toContain('Masa Musteri');
    await ctx.http().get('/public/tabs/AAAAAAAAAAAAAAAAAAAAAAAA').expect(404);

    const list = (await ctx.http().get(`/restaurants/${restaurantId}/tabs`).set(owner()).expect(200))
      .body as TabSummaryDTO[];
    expect(list.find((t) => t.tableId === tableId)).toMatchObject({ orderCount: 2, dueMinor: total });
  });

  it('collects the bill in equal shares, oldest order first, and never more than it owes', async () => {
    const tab = (await ctx.http().get(`/restaurants/${restaurantId}/tabs`).set(owner()).expect(200)).body.find(
      (t: TabSummaryDTO) => t.tableId === tableId,
    ) as TabSummaryDTO;
    const [share1, share2] = splitEqual(tab.dueMinor, 2);
    const afterFirst = (await collect(tab.id, share1)).body as TabBillDTO;
    expect(afterFirst).toMatchObject({ paidMinor: share1, dueMinor: share2, status: 'OPEN' });
    expect(afterFirst.orders[0].dueMinor).toBe(Math.max(0, afterFirst.orders[0].chargedToCustomerMinor - share1));
    expect((await collect(tab.id, share2 + 1, 409)).headers['x-error-code']).toBe('PAYMENT_STATE_INVALID');
    expect(
      (await ctx.http().post(`/restaurants/${restaurantId}/tabs/${tab.id}/close`).set(owner()).expect(409)).headers[
        'x-error-code'
      ],
    ).toBe('TAB_NOT_SETTLED');

    const paid = (await collect(tab.id, share2)).body as TabBillDTO;
    expect(paid).toMatchObject({ dueMinor: 0, paidMinor: tab.dueMinor });
    // The orders are still in the kitchen: the tab stays open until closed by hand.
    expect(paid.status).toBe('OPEN');
    for (const order of paid.orders) {
      const detail = (await ctx.http().get(`/restaurants/${restaurantId}/orders/${order.id}`).set(owner()).expect(200))
        .body as OrderDetailDTO;
      expect(detail.payment.dueMinor).toBe(0);
    }
    await collect(tab.id, 100, 409);
    const closed = (await ctx.http().post(`/restaurants/${restaurantId}/tabs/${tab.id}/close`).set(owner()).expect(200))
      .body as TabBillDTO;
    expect(closed.status).toBe('CLOSED');
    await collect(tab.id, 100, 409);

    // The next order at the table opens a new tab.
    const next = await waiterOrder(1);
    expect(next.tabId).not.toBe(tab.id);
  });

  it('closes by itself once every order is served and paid', async () => {
    const page = (await ctx.http().get(`/public/qr/${tableToken}`).expect(200)).body as StorefrontDTO;
    const token = page.tab!.open!.token;
    const open = (await ctx.http().get(`/public/tabs/${token}`).expect(200)).body as TabBillDTO;
    for (const order of open.orders) await serve(order.id);
    const closed = (await collect(open.id, open.dueMinor)).body as TabBillDTO;
    expect(closed).toMatchObject({ status: 'CLOSED', dueMinor: 0 });
    const after = (await ctx.http().get(`/public/qr/${tableToken}`).expect(200)).body as StorefrontDTO;
    expect(after.tab?.open).toBeNull();
  });

  it('lets only one of two simultaneous collections take the last amount', async () => {
    const order = await waiterOrder(2);
    const tabId = order.tabId!;
    const due = (await bill(tabId)).dueMinor;
    const results = await Promise.all([
      ctx
        .http()
        .post(`/restaurants/${restaurantId}/tabs/${tabId}/collect`)
        .set(owner())
        .send({ method: 'CASH_ON_DELIVERY', amountMinor: due }),
      ctx
        .http()
        .post(`/restaurants/${restaurantId}/tabs/${tabId}/collect`)
        .set(owner())
        .send({ method: 'CASH_ON_DELIVERY', amountMinor: due }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await bill(tabId)).paidMinor).toBe(due);
  });

  it('counts every partial collection on an order paid on its own', async () => {
    const res = await guestOrder({ payment: { method: 'CASH_ON_DELIVERY' } });
    const row = await ctx.prisma.order.findFirstOrThrow({ where: { trackingToken: res.body.trackingToken } });
    const part = Math.floor(row.chargedToCustomerMinor / 3);
    const pay = (amountMinor?: number, status = 201) =>
      ctx
        .http()
        .post(`/restaurants/${restaurantId}/orders/${row.id}/collect`)
        .set(owner())
        .send({ method: 'CASH_ON_DELIVERY', ...(amountMinor ? { amountMinor } : {}) });
    const first = (await pay(part)).body as OrderDetailDTO;
    expect(first.payment.dueMinor).toBe(row.chargedToCustomerMinor - part);
    const second = (await pay(part)).body as OrderDetailDTO;
    expect(second.payment.dueMinor).toBe(row.chargedToCustomerMinor - 2 * part);
    const rest = (await pay()).body as OrderDetailDTO;
    expect(rest.payment.dueMinor).toBe(0);
    expect((await pay(1)).status).toBe(409);
  });
});
