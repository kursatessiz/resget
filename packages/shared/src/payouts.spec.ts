import { computeOrderSettlement } from './settlement';
import { addBusinessDays, orderLedgerLines, previousPayoutPeriod } from './payouts';

describe('payout rules', () => {
  it('adds business days skipping weekends', () => {
    // Friday 2026-07-03 plus 5 business days is Friday 2026-07-10.
    expect(addBusinessDays(new Date('2026-07-03T00:00:00Z'), 5).toISOString()).toBe('2026-07-10T00:00:00.000Z');
    expect(addBusinessDays(new Date('2026-07-06T00:00:00Z'), 1).toISOString()).toBe('2026-07-07T00:00:00.000Z');
  });

  it('closes the week on Monday 00:00 UTC', () => {
    const period = previousPayoutPeriod(new Date('2026-07-08T15:00:00Z')); // a Wednesday
    expect(period.periodStart.toISOString()).toBe('2026-06-29T00:00:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2026-07-06T00:00:00.000Z');
    const monday = previousPayoutPeriod(new Date('2026-07-06T00:30:00Z'));
    expect(monday.periodEnd.toISOString()).toBe('2026-07-06T00:00:00.000Z');
  });

  it('rebuilds the engine ledger from an order snapshot and reconciles to the payable', () => {
    const settlement = computeOrderSettlement({
      currency: 'XTS',
      items: [{ amountMinor: 50000, vatRateBps: 1000 }],
      deliveryFee: { amountMinor: 1500, vatRateBps: 2000 },
      commissionBps: 100,
      commissionVatBps: 2000,
      psp: { percentBps: 200, fixedMinor: 0, bearer: 'RESTAURANT' },
      withholdingBps: 100,
    });
    const lines = orderLedgerLines({
      itemsGrossMinor: settlement.itemsGrossMinor,
      discountMinor: settlement.discountMinor,
      discountFundedBy: settlement.discountFundedBy,
      deliveryFeeMinor: settlement.deliveryFeeMinor,
      courierCostMinor: settlement.courierCostMinor,
      courierBearer: settlement.courierBearer,
      platformCommissionMinor: settlement.platformCommissionMinor,
      commissionVatMinor: settlement.commissionVatMinor,
      pspFeeMinor: settlement.pspFeeMinor,
      withholdingMinor: settlement.withholdingMinor,
      restaurantPayableMinor: settlement.restaurantPayableMinor,
    });
    expect(lines).toEqual(settlement.ledger);
    const drifted = orderLedgerLines({
      itemsGrossMinor: 10000,
      discountMinor: 0,
      discountFundedBy: null,
      deliveryFeeMinor: 0,
      courierCostMinor: 0,
      courierBearer: null,
      platformCommissionMinor: 100,
      commissionVatMinor: 20,
      pspFeeMinor: 0,
      withholdingMinor: 0,
      restaurantPayableMinor: 9800,
    });
    expect(drifted.find((l) => l.type === 'ADJUSTMENT')?.amountMinor).toBe(-80);
    expect(drifted.filter((l) => l.type !== 'RESTAURANT_PAYABLE').reduce((n, l) => n + l.amountMinor, 0)).toBe(9800);
  });
});
