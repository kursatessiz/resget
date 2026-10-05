import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const NOTE = 'e2e-accounting';

/** A month of orders and lines as CSV for the accountant (docs/MUHASEBE_AKTARIMI.md). */
describe('Accounting export (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let courierToken: string;
  let restaurantId: string;
  let branchId: string;
  let itemId: string;
  const now = new Date();
  const period = `year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`;
  const owner = () => bearer(ownerToken);
  const download = (kind: string, query = period) =>
    ctx.http().get(`/restaurants/${restaurantId}/accounting/${kind}.csv?${query}`).set(owner());
  const rowsOf = (csv: string) =>
    csv
      .replace(/^﻿/, '')
      .trim()
      .split('\r\n')
      .map((line) => line.split(','));

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true, menuItems: true },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    itemId = restaurant.menuItems.find((m) => m.name === 'Izgara kofte')!.id;
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    [adminToken, ownerToken, courierToken] = await Promise.all([
      ctx.login(SEED.superAdminPhone),
      ctx.login(SEED.ownerPhone),
      ctx.login('+905320000004'),
    ]);
  });

  afterAll(async () => {
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'accounting_export' } });
    await ctx.close();
  });

  it('is off by default and needs finance access', async () => {
    expect((await download('orders').expect(403)).headers['x-error-code']).toBe('FEATURE_DISABLED');
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/accounting_export`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/accounting/orders.csv?${period}`)
      .set(bearer(courierToken))
      .expect(403);
    await download('orders', 'year=2026&month=13').expect(400);
  });

  it('lists the month with the settlement snapshot of each order and its lines', async () => {
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 3 }],
        note: NOTE,
      })
      .expect(201);
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: created.body.id } });

    const res = await download('orders').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/resget-orders-\d{4}-\d{2}\.csv/);
    const [header, ...rows] = rowsOf(res.text);
    const col = (name: string) => header.indexOf(name);
    const row = rows.find((r) => r[col('orderId')] === order.id)!;
    expect(row).toBeDefined();
    expect(row[col('status')]).toBe('PLACED');
    expect(row[col('currency')]).toBe(order.currency);
    // Decimal major units, the same numbers the order carries.
    expect(Math.round(Number(row[col('chargedToCustomer')]) * 100)).toBe(order.chargedToCustomerMinor);
    expect(Math.round(Number(row[col('commission')]) * 100)).toBe(order.platformCommissionMinor);
    expect(Math.round(Number(row[col('itemsNet')]) * 100)).toBe(order.itemsGrossMinor - order.itemsVatMinor);
    expect(row[col('refunded')]).toBe('0.00');

    const lines = await download('lines').expect(200);
    const [lineHeader, ...lineRows] = rowsOf(lines.text);
    const line = lineRows.find((r) => r[lineHeader.indexOf('order')] === row[col('order')])!;
    expect(line[lineHeader.indexOf('item')]).toBe('Izgara kofte');
    expect(line[lineHeader.indexOf('quantity')]).toBe('3');
    expect(line[lineHeader.indexOf('vatRatePercent')]).toMatch(/^\d+\.\d{2}$/);
  });

  it('leaves out orders still waiting for an online payment and other months', async () => {
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 1 }],
        note: NOTE,
      })
      .expect(201);
    await ctx.prisma.order.update({ where: { id: created.body.id }, data: { status: 'PENDING_PAYMENT' } });
    const res = await download('orders').expect(200);
    expect(res.text).not.toContain(created.body.id);
    const empty = rowsOf((await download('orders', 'year=2024&month=1').expect(200)).text);
    expect(empty).toHaveLength(1);
  });
});
