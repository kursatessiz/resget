import type { PaymentMode, PayoutCadence } from '@resget/database';
import type { InstantPayoutQuoteDTO, PayoutDTO, PayoutScheduleDTO, PayoutScheduleOptionDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const MEMO = 'e2e-payout-schedules';
const INVOICE_MONTH = new Date('2025-03-01T00:00:00Z');

/** Weekly, daily and instant payouts with their fees, plan rules and the invoice line (docs/HAKEDIS_TAKVIMI.md). */
describe('Payout schedules (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let currency: string;
  let original: { paymentMode: PaymentMode; payoutCadence: PayoutCadence };
  let originalTrialEndsAt: Date | null;
  const admin = () => bearer(adminToken);
  const owner = () => bearer(ownerToken);
  const base = () => `/restaurants/${restaurantId}/finance`;

  const line = (amountMinor: number, occurredAt: Date) =>
    ctx.prisma.ledgerEntry.create({
      data: { restaurantId, type: 'RESTAURANT_PAYABLE', amountMinor, currency, occurredAt, memo: MEMO },
    });
  const saveOption = (body: Record<string, unknown>, status = 200) =>
    ctx
      .http()
      .put('/admin/payouts/options')
      .set(admin())
      .send({
        currency,
        feeBps: 0,
        feeFixedMinor: 0,
        settleBusinessDays: 1,
        requiresFastPayouts: false,
        freeWithFastPayouts: false,
        isActive: true,
        ...body,
      })
      .expect(status);
  const onBasic = () =>
    ctx.prisma.restaurantSubscription.update({
      where: { restaurantId },
      data: { trialEndsAt: new Date(Date.now() - 86_400_000) },
    });
  const onPro = () =>
    ctx.prisma.restaurantSubscription.update({
      where: { restaurantId },
      data: { trialEndsAt: new Date(Date.now() + 30 * 86_400_000) },
    });
  const instant = () => ctx.http().post(`${base()}/payouts/instant`).set(owner());

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { subscription: true },
    });
    restaurantId = restaurant.id;
    currency = restaurant.currency;
    original = { paymentMode: restaurant.paymentMode, payoutCadence: restaurant.payoutCadence };
    originalTrialEndsAt = restaurant.subscription?.trialEndsAt ?? null;
    // Unassigned payable lines from other suites would join our payouts.
    await ctx.prisma.ledgerEntry.deleteMany({ where: { restaurantId, payoutId: null, invoiceId: null } });
  });

  afterAll(async () => {
    const payouts = await ctx.prisma.payout.findMany({
      where: { restaurantId, cadence: { in: ['DAILY', 'INSTANT'] } },
    });
    await ctx.prisma.ledgerEntry.deleteMany({
      where: {
        OR: [{ memo: MEMO }, { payoutId: { in: payouts.map((p) => p.id) } }, { memo: { startsWith: 'payout fee' } }],
      },
    });
    await ctx.prisma.payout.deleteMany({ where: { id: { in: payouts.map((p) => p.id) } } });
    await ctx.prisma.commissionInvoice.deleteMany({ where: { periodStart: INVOICE_MONTH } });
    await ctx.prisma.payoutScheduleOption.deleteMany({ where: { currency } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'payout_schedules' } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: original });
    await ctx.prisma.restaurantSubscription.update({
      where: { restaurantId },
      data: { trialEndsAt: originalTrialEndsAt },
    });
    await ctx.close();
  });

  it('is off by default and the options are platform data', async () => {
    const off = await ctx.http().get(`${base()}/payout-schedule`).set(owner()).expect(403);
    expect(off.headers['x-error-code']).toBe('FEATURE_DISABLED');
    await ctx.http().put('/admin/payouts/options').set(owner()).send({}).expect(403);
    await saveOption({
      cadence: 'DAILY',
      feeBps: 50,
      feeFixedMinor: 300,
      settleBusinessDays: 1,
      freeWithFastPayouts: true,
    });
    const options = (await saveOption({ cadence: 'INSTANT', feeBps: 100, feeFixedMinor: 500, settleBusinessDays: 0 }))
      .body as PayoutScheduleOptionDTO[];
    expect(
      options
        .filter((o) => o.currency === currency)
        .map((o) => o.cadence)
        .sort(),
    ).toEqual(['DAILY', 'INSTANT']);
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/payout_schedules`)
      .set(admin())
      .send({ enabled: true })
      .expect(200);
  });

  it('offers the schedules to a restaurant the platform collects for, with the fee its plan pays', async () => {
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    await ctx
      .http()
      .put(`${base()}/payout-schedule`)
      .set(owner())
      .send({ cadence: 'DAILY' })
      .expect(409)
      .expect('x-error-code', 'PAYOUT_SCHEDULE_UNAVAILABLE');
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'PLATFORM_PSP' } });
    await onBasic();
    const view = (await ctx.http().get(`${base()}/payout-schedule`).set(owner()).expect(200)).body as PayoutScheduleDTO;
    expect(view).toMatchObject({ enabled: true, cadence: 'WEEKLY', currency });
    expect(view.options.find((o) => o.cadence === 'DAILY')).toMatchObject({ free: false, needsPlan: false });
    const chosen = (
      await ctx.http().put(`${base()}/payout-schedule`).set(owner()).send({ cadence: 'DAILY' }).expect(200)
    ).body as PayoutScheduleDTO;
    expect(chosen.cadence).toBe('DAILY');
  });

  it('rolls the closed day into a daily payout and takes the fee as a ledger line', async () => {
    const asOf = new Date(Date.UTC(2026, 9, 7, 8, 0));
    await line(100_000, new Date(Date.UTC(2026, 9, 6, 10, 0)));
    await ctx.http().post('/admin/payouts/run').set(admin()).send({ asOf: asOf.toISOString() }).expect(200);
    const payout = await ctx.prisma.payout.findFirstOrThrow({ where: { restaurantId, cadence: 'DAILY' } });
    expect(payout).toMatchObject({ amountMinor: 99_200, feeMinor: 800 });
    expect(payout.periodStart.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(payout.scheduledFor.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    const fee = await ctx.prisma.ledgerEntry.findFirstOrThrow({ where: { payoutId: payout.id, type: 'PAYOUT_FEE' } });
    expect(fee.amountMinor).toBe(-800);
    // Once per day.
    await ctx.http().post('/admin/payouts/run').set(admin()).send({ asOf: asOf.toISOString() }).expect(200);
    expect(await ctx.prisma.payout.count({ where: { restaurantId, cadence: 'DAILY' } })).toBe(1);
  });

  it('waives the daily fee on a plan with fast payouts', async () => {
    await onPro();
    await line(40_000, new Date(Date.UTC(2026, 9, 7, 12, 0)));
    await ctx
      .http()
      .post('/admin/payouts/run')
      .set(admin())
      .send({ asOf: new Date(Date.UTC(2026, 9, 8, 8, 0)).toISOString() })
      .expect(200);
    const payout = await ctx.prisma.payout.findFirstOrThrow({
      where: { restaurantId, cadence: 'DAILY', periodStart: new Date(Date.UTC(2026, 9, 7)) },
    });
    expect(payout).toMatchObject({ amountMinor: 40_000, feeMinor: 0 });
    expect(await ctx.prisma.ledgerEntry.count({ where: { payoutId: payout.id, type: 'PAYOUT_FEE' } })).toBe(0);
  });

  it('pays the balance instantly on request, once, with its fee', async () => {
    await line(50_000, new Date(Date.now() - 3_600_000));
    const quote = (await ctx.http().get(`${base()}/payouts/instant/quote`).set(owner()).expect(200))
      .body as InstantPayoutQuoteDTO;
    expect(quote).toMatchObject({ amountMinor: 50_000, feeMinor: 1_000, netMinor: 49_000, currency });
    const paid = (await instant().expect(201)).body as PayoutDTO;
    expect(paid).toMatchObject({ cadence: 'INSTANT', amountMinor: 49_000, feeMinor: 1_000 });
    expect((await instant().expect(409)).headers['x-error-code']).toBe('PAYOUT_NOTHING_DUE');

    await line(20_000, new Date(Date.now() - 60_000));
    const results = await Promise.all([instant(), instant()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const instants = await ctx.prisma.payout.findMany({ where: { restaurantId, cadence: 'INSTANT' } });
    expect(instants.reduce((sum, p) => sum + p.amountMinor + p.feeMinor, 0)).toBe(70_000);
  });

  it('keeps an option that needs fast payouts away from other plans', async () => {
    await saveOption({
      cadence: 'INSTANT',
      feeBps: 100,
      feeFixedMinor: 500,
      settleBusinessDays: 0,
      requiresFastPayouts: true,
    });
    await onBasic();
    await line(10_000, new Date(Date.now() - 60_000));
    expect((await instant().expect(403)).headers['x-error-code']).toBe('PLAN_FEATURE_REQUIRED');
    const view = (await ctx.http().get(`${base()}/payout-schedule`).set(owner()).expect(200)).body as PayoutScheduleDTO;
    expect(view.options.find((o) => o.cadence === 'INSTANT')?.needsPlan).toBe(true);
  });

  it("puts the month's payout fees on the invoice as a line already collected", async () => {
    await ctx.prisma.ledgerEntry.create({
      data: {
        restaurantId,
        type: 'PAYOUT_FEE',
        amountMinor: -1_200,
        currency,
        occurredAt: new Date('2025-03-10T12:00:00Z'),
        memo: MEMO,
      },
    });
    await ctx.http().post('/admin/billing/run').set(admin()).send({ asOf: '2025-04-02T06:00:00.000Z' }).expect(200);
    const invoice = await ctx.prisma.commissionInvoice.findFirstOrThrow({
      where: { restaurantId, periodStart: INVOICE_MONTH },
    });
    expect(invoice).toMatchObject({
      payoutFeeMinor: 1_000,
      payoutFeeVatMinor: 200,
      deductedMinor: 1_200,
      totalMinor: invoice.commissionMinor + invoice.vatMinor + 1_200,
    });
    if (invoice.commissionMinor === 0) {
      expect(invoice).toMatchObject({ status: 'PAID', paymentRef: 'payout-deduction' });
    }
    await ctx
      .http()
      .post(`/admin/billing/invoices/${invoice.id}/void`)
      .set(admin())
      .expect(409)
      .expect('x-error-code', 'INVOICE_STATE_INVALID');
  });
});
