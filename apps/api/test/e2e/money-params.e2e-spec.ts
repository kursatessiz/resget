import { randomUUID } from 'node:crypto';
import { commissionPeriod, normalizePhone } from '@resget/shared';
import { BillingService } from '../../src/modules/billing/billing.service';
import { PayoutsService } from '../../src/modules/payouts/payouts.service';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { deleteTestRestaurants } from './support/cleanup';

/**
 * Money parameters a tenant controls (security fixes, run 2): one tenant's
 * failure never stops the daily billing run for the others, money inputs have
 * an upper bound, platform-collected payments need the platform's PSP rate,
 * self sign-up is open only where the platform has settlement rules, and the
 * billing card follows its owner's membership.
 */
describe('Tenant-controlled money parameters (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let memberToken: string;
  const ownerPhone = normalizePhone('05329810001')!;
  const memberPhone = normalizePhone('05329810002')!;
  const consolePhone = normalizePhone('05329810003')!;
  const restaurantIds: string[] = [];
  let bigId: string;
  let smallId: string;
  let smallBranchId: string;
  let bigBranchId: string;
  // A closed month far in the past, so the run touches nothing other suites rely on.
  const RUN_AS_OF = '2020-03-02T06:00:00.000Z';
  const FEB = commissionPeriod(2020, 2);
  const JAN = commissionPeriod(2020, 1);

  const signup = (name: string, countryCode = 'TR', currency = 'TRY') =>
    ctx
      .http()
      .post('/restaurants')
      .set(bearer(ownerToken))
      .send({
        name,
        countryCode,
        currency,
        timezone: 'Europe/Istanbul',
        defaultLocale: 'tr',
        branch: { addressLine: 'Test Sok. No 1', city: 'Istanbul', district: 'Kadikoy', lat: 40.99, lng: 29.03 },
      });

  const completedOrder = (restaurantId: string, branchId: string, grossMinor: number, completedAt: Date) => {
    const commission = Math.round(grossMinor / 100);
    return ctx.prisma.order.create({
      data: {
        restaurantId,
        branchId,
        channel: 'RESTAURANT_SITE',
        fulfillment: 'PICKUP',
        deliveryMode: 'RESTAURANT_COURIER',
        status: 'PICKED_UP',
        currency: 'TRY',
        itemsGrossMinor: grossMinor,
        itemsVatMinor: 0,
        deliveryFeeMinor: 0,
        chargedToCustomerMinor: grossMinor,
        commissionBps: 100,
        platformCommissionMinor: commission,
        commissionVatMinor: Math.round(commission / 5),
        pspFeeMinor: 0,
        withholdingMinor: 0,
        restaurantPayableMinor: grossMinor,
        paymentMode: 'OWN_POS',
        platformReceivableMinor: commission + Math.round(commission / 5),
        trackingToken: `money-${randomUUID()}`,
        placedAt: completedAt,
        completedAt,
      },
      select: { id: true },
    });
  };

  const openInvoice = (restaurantId: string, period: { periodStart: Date; periodEnd: Date }) =>
    ctx.prisma.commissionInvoice.create({
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
        issuedAt: period.periodEnd,
        dueAt: new Date(period.periodEnd.getTime() + 10 * 86_400_000),
      },
    });

  const runBilling = () => ctx.http().post('/admin/billing/run').set(bearer(adminToken)).send({ asOf: RUN_AS_OF });

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.prisma.user.deleteMany({ where: { phone: { in: [ownerPhone, memberPhone, consolePhone] } } });
    adminToken = await ctx.login(SEED.superAdminPhone);
    ownerToken = await ctx.login(ownerPhone);
    memberToken = await ctx.login(memberPhone);
    const big = (await signup('Money Big').expect(201)).body as { id: string };
    const small = (await signup('Money Small').expect(201)).body as { id: string };
    bigId = big.id;
    smallId = small.id;
    restaurantIds.push(bigId, smallId);
    bigBranchId = (await ctx.prisma.branch.findFirstOrThrow({ where: { restaurantId: bigId } })).id;
    smallBranchId = (await ctx.prisma.branch.findFirstOrThrow({ where: { restaurantId: smallId } })).id;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await deleteTestRestaurants(ctx.prisma, { id: { in: restaurantIds } });
    await ctx.prisma.savedPaymentMethod.deleteMany({ where: { user: { phone: { in: [ownerPhone, memberPhone] } } } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: [ownerPhone, memberPhone, consolePhone] } } });
    await ctx.close();
  });

  describe('billing.service/issue-period-int32-overflow-aborts-run', () => {
    it('invoices the other tenants when one tenant cannot be invoiced, and reports it', async () => {
      // Each order fits a 32-bit column; the month's sum does not.
      const bigOrders = [
        await completedOrder(bigId, bigBranchId, 1_500_000_000, new Date(FEB.periodStart.getTime() + 2 * 86_400_000)),
        await completedOrder(bigId, bigBranchId, 1_500_000_000, new Date(FEB.periodStart.getTime() + 3 * 86_400_000)),
      ];
      await completedOrder(smallId, smallBranchId, 50000, new Date(FEB.periodStart.getTime() + 4 * 86_400_000));

      const run = await runBilling();
      // The oversized orders are gone for the rest of the suite, whatever the outcome.
      await ctx.prisma.order.deleteMany({ where: { id: { in: bigOrders.map((o) => o.id) } } });
      const small = await ctx.prisma.commissionInvoice.findUnique({
        where: { restaurantId_periodStart: { restaurantId: smallId, periodStart: FEB.periodStart } },
      });
      expect(small).toMatchObject({ status: 'ISSUED', commissionMinor: 500 });
      expect(run.status).toBe(200);
      expect(run.body.tenantFailures).toEqual(expect.arrayContaining([{ step: 'issue', restaurantId: bigId }]));
      expect(
        await ctx.prisma.commissionInvoice.count({ where: { restaurantId: bigId, periodStart: FEB.periodStart } }),
      ).toBe(0);
      const audit = await ctx.prisma.auditLog.findFirst({
        where: { action: 'billing.run', entityId: FEB.periodStart.toISOString() },
        orderBy: { createdAt: 'desc' },
      });
      expect(JSON.stringify(audit?.meta)).toContain(bigId);
    });

    it('collects the other tenants when one tenant charge throws', async () => {
      const card = await ctx
        .http()
        .post('/me/payment-methods/link/complete')
        .set(bearer(ownerToken))
        .send({ payload: {} })
        .expect(200);
      const cardId = card.body[0].id as string;
      for (const id of [bigId, smallId]) {
        await ctx
          .http()
          .put(`/restaurants/${id}/billing/card`)
          .set(bearer(ownerToken))
          .send({ paymentMethodId: cardId })
          .expect(200);
      }
      const bigInvoice = await openInvoice(bigId, JAN);
      const billing = ctx.app.get(BillingService) as unknown as {
        charge: (invoice: { id: string }, ...rest: unknown[]) => Promise<unknown>;
      };
      const original = billing.charge.bind(billing);
      const spy = jest.spyOn(billing, 'charge').mockImplementation(async (invoice, ...rest) => {
        if (invoice.id === bigInvoice.id) throw new Error('injected charge failure');
        return original(invoice, ...rest);
      });
      try {
        const run = await runBilling();
        expect(run.status).toBe(200);
        expect(run.body.tenantFailures).toEqual(expect.arrayContaining([{ step: 'collect', restaurantId: bigId }]));
      } finally {
        spy.mockRestore();
      }
      const small = await ctx.prisma.commissionInvoice.findUniqueOrThrow({
        where: { restaurantId_periodStart: { restaurantId: smallId, periodStart: FEB.periodStart } },
      });
      expect(small.status).toBe('PAID');
      await ctx.prisma.commissionInvoice.delete({ where: { id: bigInvoice.id } });
    });

    it('rolls payouts for the other tenants when one tenant fails', async () => {
      const occurredAt = new Date(FEB.periodStart.getTime() + 19 * 86_400_000);
      await ctx.prisma.ledgerEntry.createMany({
        data: [bigId, smallId].map((restaurantId) => ({
          restaurantId,
          type: 'RESTAURANT_PAYABLE' as const,
          amountMinor: 10000,
          currency: 'TRY',
          occurredAt,
          memo: 'money-params e2e',
        })),
      });
      const payouts = ctx.app.get(PayoutsService) as unknown as {
        effectiveSchedule: (restaurant: { id: string }, ...rest: unknown[]) => Promise<unknown>;
      };
      const original = payouts.effectiveSchedule.bind(payouts);
      const spy = jest.spyOn(payouts, 'effectiveSchedule').mockImplementation(async (restaurant, ...rest) => {
        if (restaurant.id === bigId) throw new Error('injected payout failure');
        return original(restaurant, ...rest);
      });
      try {
        const run = await runBilling();
        expect(run.status).toBe(200);
        expect(run.body.tenantFailures).toEqual(expect.arrayContaining([{ step: 'payouts', restaurantId: bigId }]));
      } finally {
        spy.mockRestore();
      }
      expect(await ctx.prisma.payout.count({ where: { restaurantId: smallId } })).toBe(1);
      expect(await ctx.prisma.payout.count({ where: { restaurantId: bigId } })).toBe(0);
    });

    it('refuses a menu price or an order total beyond the money bound', async () => {
      const category = await ctx
        .http()
        .post(`/restaurants/${smallId}/menu/categories`)
        .set(bearer(ownerToken))
        .send({ name: 'Bound' })
        .expect(201);
      await ctx
        .http()
        .post(`/restaurants/${smallId}/menu/items`)
        .set(bearer(ownerToken))
        .send({ categoryId: category.body.id, name: 'Too dear', priceMinor: 2_000_000_000, vatRateBps: 1000 })
        .expect(400)
        .expect('x-error-code', 'VALIDATION');
      const item = await ctx
        .http()
        .post(`/restaurants/${smallId}/menu/items`)
        .set(bearer(ownerToken))
        .send({ categoryId: category.body.id, name: 'Dear', priceMinor: 90_000_000, vatRateBps: 1000 })
        .expect(201);
      await ctx
        .http()
        .post(`/restaurants/${smallId}/orders`)
        .set(bearer(ownerToken))
        .send({
          branchId: smallBranchId,
          channel: 'PHONE',
          fulfillment: 'PICKUP',
          items: [{ menuItemId: item.body.id, quantity: 2 }],
        })
        .expect(400)
        .expect('x-error-code', 'ORDER_TOTAL_TOO_LARGE');
    });
  });

  describe('payments.service/self-service-platform-psp-mode-with-zero-psp-rate', () => {
    it('refuses PLATFORM_PSP until the platform has set the restaurant PSP rate', async () => {
      await ctx
        .http()
        .put(`/restaurants/${smallId}/payments/mode`)
        .set(bearer(ownerToken))
        .send({ paymentMode: 'PLATFORM_PSP' })
        .expect(403)
        .expect('x-error-code', 'PLATFORM_PSP_NOT_READY');
      expect((await ctx.prisma.restaurant.findUniqueOrThrow({ where: { id: smallId } })).paymentMode).toBe('OWN_POS');
      await ctx
        .http()
        .patch(`/admin/restaurants/${smallId}`)
        .set(bearer(adminToken))
        .send({ pspPercentBps: 180, pspFixedMinor: 25 })
        .expect(200);
      const ok = await ctx
        .http()
        .put(`/restaurants/${smallId}/payments/mode`)
        .set(bearer(ownerToken))
        .send({ paymentMode: 'PLATFORM_PSP' })
        .expect(200);
      expect(ok.body.paymentMode).toBe('PLATFORM_PSP');
    });
  });

  describe('settlement/self-declared-country-selects-tax-defaults', () => {
    it('opens self sign-up only to countries with platform settlement rules', async () => {
      const refused = await signup('Money Abroad', 'DE', 'EUR');
      if (refused.status === 201) restaurantIds.push(refused.body.id as string);
      expect(refused.status).toBe(403);
      expect(refused.headers['x-error-code']).toBe('SIGNUP_COUNTRY_NOT_AVAILABLE');
      // The console still creates a restaurant anywhere it operates.
      const created = await ctx
        .http()
        .post('/admin/restaurants')
        .set(bearer(adminToken))
        .send({
          name: 'Money Console Abroad',
          countryCode: 'DE',
          currency: 'EUR',
          timezone: 'Europe/Berlin',
          defaultLocale: 'en',
          branch: { addressLine: 'Teststr. 1', city: 'Berlin', district: 'Mitte', lat: 52.52, lng: 13.4 },
          ownerPhone: consolePhone,
          ownerName: 'Console Owner',
        })
        .expect(201);
      restaurantIds.push(created.body.id as string);
    });
  });

  describe('billing.service/billing-card-survives-card-owner-membership-loss', () => {
    let membershipId: string;
    let financeRoleId: string;
    let counterRoleId: string;
    let memberCardId: string;

    const designate = async () => {
      await ctx
        .http()
        .put(`/restaurants/${smallId}/billing/card`)
        .set(bearer(memberToken))
        .send({ paymentMethodId: memberCardId })
        .expect(200);
      expect((await ctx.prisma.restaurant.findUniqueOrThrow({ where: { id: smallId } })).billingPaymentMethodId).toBe(
        memberCardId,
      );
    };
    const billingCardId = async () =>
      (await ctx.prisma.restaurant.findUniqueOrThrow({ where: { id: smallId } })).billingPaymentMethodId;

    beforeAll(async () => {
      const role = await ctx
        .http()
        .post(`/restaurants/${smallId}/staff/roles`)
        .set(bearer(ownerToken))
        .send({ name: 'Finans', permissions: ['payments.manage', 'invoices.view'] })
        .expect(201);
      financeRoleId = role.body.id as string;
      counterRoleId = (
        await ctx.prisma.roleTemplate.findFirstOrThrow({ where: { restaurantId: smallId, templateKey: 'counter' } })
      ).id;
      const member = await ctx.prisma.user.findUniqueOrThrow({ where: { phone: memberPhone } });
      membershipId = (
        await ctx.prisma.membership.create({
          data: {
            userId: member.id,
            restaurantId: smallId,
            roleTemplateId: financeRoleId,
            status: 'ACTIVE',
            joinedAt: new Date(),
          },
        })
      ).id;
      const cards = await ctx
        .http()
        .post('/me/payment-methods/link/complete')
        .set(bearer(memberToken))
        .send({ payload: {} })
        .expect(200);
      memberCardId = cards.body[0].id as string;
    });

    it('detaches the billing card when its owner is made passive', async () => {
      await designate();
      await ctx
        .http()
        .patch(`/restaurants/${smallId}/staff/members/${membershipId}`)
        .set(bearer(ownerToken))
        .send({ status: 'PASSIVE' })
        .expect(200);
      expect(await billingCardId()).toBeNull();
    });

    it('detaches the billing card when its owner loses payments.manage', async () => {
      await ctx
        .http()
        .patch(`/restaurants/${smallId}/staff/members/${membershipId}`)
        .set(bearer(ownerToken))
        .send({ status: 'ACTIVE' })
        .expect(200);
      await designate();
      await ctx
        .http()
        .patch(`/restaurants/${smallId}/staff/members/${membershipId}`)
        .set(bearer(ownerToken))
        .send({ roleTemplateId: counterRoleId })
        .expect(200);
      expect(await billingCardId()).toBeNull();
    });

    it('never charges a card whose owner no longer holds payments.manage', async () => {
      // A role edit or any other path that left the card attached: the charge paths check the holder themselves.
      await ctx.prisma.restaurant.update({ where: { id: smallId }, data: { billingPaymentMethodId: memberCardId } });
      const invoice = await openInvoice(smallId, JAN);
      await ctx
        .http()
        .post(`/admin/billing/invoices/${invoice.id}/collect`)
        .set(bearer(adminToken))
        .send({})
        .expect(400)
        .expect('x-error-code', 'BILLING_CARD_REQUIRED');
      await ctx
        .http()
        .post(`/restaurants/${smallId}/billing/invoices/${invoice.id}/pay`)
        .set(bearer(ownerToken))
        .send({ returnUrl: 'https://app.example.com/finans' })
        .expect(400)
        .expect('x-error-code', 'BILLING_CARD_REQUIRED');
      // The daily collector skips it too, and detaches the card again.
      await ctx.prisma.restaurant.update({ where: { id: smallId }, data: { billingPaymentMethodId: memberCardId } });
      await runBilling().expect(200);
      const after = await ctx.prisma.commissionInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.status).not.toBe('PAID');
      expect(after).toMatchObject({ collectionAttempts: 0, paymentMethodId: null });
      expect(await billingCardId()).toBeNull();
    });
  });
});
