import { randomUUID } from 'node:crypto';
import { commissionPeriod } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/**
 * Commission billing (docs/FATURALAMA.md): the daily job cuts last month,
 * numbers the fiscal document, ages unpaid invoices into a marketplace
 * suspension, and collects from the billing card; the owner pays from the
 * panel; the console settles transfers and voids.
 */
describe('Commission billing (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let guestToken: string;
  let restaurantId: string;
  let branchId: string;
  let menuItemId: string;
  const orderIds: string[] = [];
  const invoiceIds: string[] = [];
  const now = new Date();
  // Two completed OWN_POS orders in each of the last two UTC months.
  const lastMonth =
    now.getUTCMonth() === 0
      ? { year: now.getUTCFullYear() - 1, month: 12 }
      : { year: now.getUTCFullYear(), month: now.getUTCMonth() };
  const monthBefore =
    lastMonth.month === 1
      ? { year: lastMonth.year - 1, month: 12 }
      : { year: lastMonth.year, month: lastMonth.month - 1 };
  const marketplace = '/public/marketplace?countryCode=TR&city=Istanbul&district=Kadikoy';

  const completedOrder = async (completedAt: Date) => {
    const order = await ctx.prisma.order.create({
      data: {
        restaurantId,
        branchId,
        channel: 'RESTAURANT_SITE',
        fulfillment: 'PICKUP',
        deliveryMode: 'RESTAURANT_COURIER',
        status: 'PICKED_UP',
        currency: 'TRY',
        itemsGrossMinor: 50000,
        itemsVatMinor: 4545,
        deliveryFeeMinor: 0,
        chargedToCustomerMinor: 50000,
        commissionBps: 100,
        platformCommissionMinor: 500,
        commissionVatMinor: 100,
        pspFeeMinor: 0,
        withholdingMinor: 0,
        restaurantPayableMinor: 50000,
        paymentMode: 'OWN_POS',
        platformReceivableMinor: 600,
        trackingToken: `bill-${randomUUID()}`,
        placedAt: completedAt,
        completedAt,
        items: {
          create: {
            menuItemId,
            nameSnapshot: 'Billing test',
            unitPriceMinor: 50000,
            quantity: 1,
            vatRateBps: 1000,
            lineTotalMinor: 50000,
            modifiersSnapshot: [],
          },
        },
      },
      select: { id: true },
    });
    orderIds.push(order.id);
  };

  const invoicesOf = () =>
    ctx.prisma.commissionInvoice.findMany({ where: { restaurantId }, orderBy: { periodStart: 'desc' } });

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login(SEED.superAdminPhone);
    ownerToken = await ctx.login(SEED.ownerPhone);
    guestToken = await ctx.login(SEED.guestPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, branches: { take: 1, select: { id: true } } },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    menuItemId = (await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId }, select: { id: true } })).id;
    const stalePeriods = [lastMonth, monthBefore].map((p) => commissionPeriod(p.year, p.month).periodStart);
    await ctx.prisma.commissionInvoice.deleteMany({ where: { restaurantId, periodStart: { in: stalePeriods } } });
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { billingPaymentMethodId: null, listingSuspendedAt: null },
    });
    const period = commissionPeriod(lastMonth.year, lastMonth.month);
    await completedOrder(new Date(period.periodStart.getTime() + 2 * 86_400_000));
    await completedOrder(new Date(period.periodStart.getTime() + 5 * 86_400_000));
  });

  afterAll(async () => {
    if (invoiceIds.length) await ctx.prisma.ledgerEntry.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    if (invoiceIds.length) await ctx.prisma.commissionInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { billingPaymentMethodId: null, listingSuspendedAt: null },
    });
    await ctx.close();
  });

  it('the daily job issues last month once, with ledger lines and a fiscal number', async () => {
    const first = await ctx.http().post('/admin/billing/run').set(bearer(adminToken)).send({}).expect(200);
    expect(first.body.issued).toBeGreaterThanOrEqual(1);
    const [invoice] = await invoicesOf();
    invoiceIds.push(invoice.id);
    expect(invoice.status).toBe('ISSUED');
    expect(invoice.orderCount).toBe(2);
    expect(invoice.commissionMinor).toBe(1000);
    expect(invoice.vatMinor).toBe(200);
    expect(invoice.totalMinor).toBe(1200);
    expect(invoice.fiscalRef).toMatch(/^MOCK/);
    expect(invoice.dueAt!.getTime() - invoice.issuedAt!.getTime()).toBe(10 * 86_400_000);
    const ledger = await ctx.prisma.ledgerEntry.findMany({ where: { invoiceId: invoice.id } });
    expect(ledger.map((l) => [l.type, l.amountMinor]).sort()).toEqual([
      ['COMMISSION_VAT', -200],
      ['PLATFORM_COMMISSION', -1000],
    ]);

    const second = await ctx.http().post('/admin/billing/run').set(bearer(adminToken)).send({}).expect(200);
    expect(second.body.issued).toBe(0);
    expect(await invoicesOf()).toHaveLength(1);

    const overview = await ctx.http().get(`/restaurants/${restaurantId}/billing`).set(bearer(ownerToken)).expect(200);
    expect(overview.body.invoices[0]).toMatchObject({ id: invoice.id, status: 'ISSUED', totalMinor: 1200 });
    expect(overview.body.openTotalMinor).toBe(1200);
    expect(overview.body.billingCard).toBeNull();
    expect(overview.body.dueDays).toBe(10);
  });

  it('an invoice past due pauses the marketplace listing until it is paid', async () => {
    const before = await ctx.http().get(marketplace).expect(200);
    expect(before.body.restaurants.map((r: { slug: string }) => r.slug)).toContain(SEED.restaurantSlug);

    const asOf = new Date(Date.now() + 11 * 86_400_000).toISOString();
    const aged = await ctx.http().post('/admin/billing/run').set(bearer(adminToken)).send({ asOf }).expect(200);
    expect(aged.body.overdue).toBeGreaterThanOrEqual(1);
    expect(aged.body.suspended).toBeGreaterThanOrEqual(1);

    const overview = await ctx.http().get(`/restaurants/${restaurantId}/billing`).set(bearer(ownerToken)).expect(200);
    expect(overview.body.invoices[0].status).toBe('OVERDUE');
    expect(overview.body.listingSuspendedAt).not.toBeNull();
    const during = await ctx.http().get(marketplace).expect(200);
    expect(during.body.restaurants.map((r: { slug: string }) => r.slug)).not.toContain(SEED.restaurantSlug);
    const detail = await ctx.http().get(`/admin/restaurants/${restaurantId}`).set(bearer(adminToken)).expect(200);
    expect(detail.body.listingSuspendedAt).not.toBeNull();

    // Paying without any card is refused with the reason.
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/billing/invoices/${invoiceIds[0]}/pay`)
      .set(bearer(ownerToken))
      .send({ returnUrl: 'https://app.example.com/finans' })
      .expect(400)
      .expect('x-error-code', 'BILLING_CARD_REQUIRED');
  });

  it('the owner designates a card, pays the overdue invoice and the listing comes back', async () => {
    const cards = await ctx
      .http()
      .post('/me/payment-methods/link/complete')
      .set(bearer(ownerToken))
      .send({ payload: {} })
      .expect(200);
    const cardId = cards.body[0].id as string;
    const withCard = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/billing/card`)
      .set(bearer(ownerToken))
      .send({ paymentMethodId: cardId })
      .expect(200);
    expect(withCard.body.billingCard.id).toBe(cardId);

    const paid = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/billing/invoices/${invoiceIds[0]}/pay`)
      .set(bearer(ownerToken))
      .send({ returnUrl: 'https://app.example.com/finans' })
      .expect(200);
    expect(paid.body.status).toBe('CAPTURED');
    expect(paid.body.invoice.status).toBe('PAID');
    expect(paid.body.invoice.paymentRef).toMatch(/^mock-charge-/);

    const overview = await ctx.http().get(`/restaurants/${restaurantId}/billing`).set(bearer(ownerToken)).expect(200);
    expect(overview.body.listingSuspendedAt).toBeNull();
    expect(overview.body.openTotalMinor).toBe(0);
    const after = await ctx.http().get(marketplace).expect(200);
    expect(after.body.restaurants.map((r: { slug: string }) => r.slug)).toContain(SEED.restaurantSlug);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { restaurantId, action: 'restaurant.listing_reinstated' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();

    // A settled invoice takes no second payment.
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/billing/invoices/${invoiceIds[0]}/pay`)
      .set(bearer(ownerToken))
      .send({ returnUrl: 'https://app.example.com/finans' })
      .expect(409)
      .expect('x-error-code', 'INVOICE_STATE_INVALID');
  });

  it('with a billing card the next cut is collected automatically', async () => {
    const period = commissionPeriod(monthBefore.year, monthBefore.month);
    await completedOrder(new Date(period.periodStart.getTime() + 3 * 86_400_000));
    // Run "on the second day of last month": the month before becomes the period to cut.
    const asOf = new Date(
      commissionPeriod(lastMonth.year, lastMonth.month).periodStart.getTime() + 86_400_000,
    ).toISOString();
    const run = await ctx.http().post('/admin/billing/run').set(bearer(adminToken)).send({ asOf }).expect(200);
    expect(run.body.issued).toBeGreaterThanOrEqual(1);
    expect(run.body.collected).toBeGreaterThanOrEqual(1);
    const invoice = await ctx.prisma.commissionInvoice.findUniqueOrThrow({
      where: { restaurantId_periodStart: { restaurantId, periodStart: period.periodStart } },
    });
    invoiceIds.push(invoice.id);
    expect(invoice.status).toBe('PAID');
    expect(invoice.totalMinor).toBe(600);
    expect(invoice.paymentRef).toMatch(/^mock-charge-/);
    expect(invoice.paymentMethodId).not.toBeNull();
  });

  it('the console settles a transfer, voids an unpaid invoice and lists everything', async () => {
    const twoBefore =
      monthBefore.month === 1
        ? { year: monthBefore.year - 1, month: 12 }
        : { year: monthBefore.year, month: monthBefore.month - 1 };
    const threeBefore =
      twoBefore.month === 1
        ? { year: twoBefore.year - 1, month: 12 }
        : { year: twoBefore.year, month: twoBefore.month - 1 };
    const manual = async (p: { year: number; month: number }) => {
      const period = commissionPeriod(p.year, p.month);
      await ctx.prisma.commissionInvoice.deleteMany({ where: { restaurantId, periodStart: period.periodStart } });
      const row = await ctx.prisma.commissionInvoice.create({
        data: {
          restaurantId,
          ...period,
          currency: 'TRY',
          orderCount: 1,
          baseMinor: 10000,
          commissionMinor: 100,
          vatMinor: 20,
          totalMinor: 120,
          status: 'ISSUED',
          issuedAt: new Date(),
          dueAt: new Date(Date.now() + 86_400_000),
        },
      });
      invoiceIds.push(row.id);
      return row.id;
    };
    const transferId = await manual(twoBefore);
    const voidId = await manual(threeBefore);

    const settled = await ctx
      .http()
      .post(`/admin/billing/invoices/${transferId}/mark-paid`)
      .set(bearer(adminToken))
      .send({ paymentRef: 'DEKONT-2026-1' })
      .expect(200);
    expect(settled.body).toMatchObject({ status: 'PAID', paymentRef: 'transfer:DEKONT-2026-1' });
    expect(settled.body.restaurant.slug).toBe(SEED.restaurantSlug);
    await ctx.http().post(`/admin/billing/invoices/${transferId}/void`).set(bearer(adminToken)).send({}).expect(409);

    const voided = await ctx
      .http()
      .post(`/admin/billing/invoices/${voidId}/void`)
      .set(bearer(adminToken))
      .send({})
      .expect(200);
    expect(voided.body.status).toBe('VOID');
    const reversal = await ctx.prisma.ledgerEntry.findFirst({ where: { invoiceId: voidId, type: 'ADJUSTMENT' } });
    expect(reversal?.amountMinor).toBe(120);

    const list = await ctx
      .http()
      .get(`/admin/billing/invoices?status=PAID&restaurantId=${restaurantId}&pageSize=10`)
      .set(bearer(adminToken))
      .expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual(
      expect.arrayContaining([transferId, invoiceIds[0]]),
    );
    expect(list.body.items.every((i: { status: string }) => i.status === 'PAID')).toBe(true);
  });

  it('keeps billing closed to a user without membership and the console to owners', async () => {
    await ctx.http().get(`/restaurants/${restaurantId}/billing`).set(bearer(guestToken)).expect(403);
    await ctx.http().get('/admin/billing/invoices').set(bearer(ownerToken)).expect(403);
  });
});
