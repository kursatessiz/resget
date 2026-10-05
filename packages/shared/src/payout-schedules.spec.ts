import { payoutFee, payoutFeeInvoiceLine, previousPayoutDay } from './payout-schedules';

describe('payout schedules', () => {
  const daily = { feeBps: 50, feeFixedMinor: 300, freeWithFastPayouts: true };

  it('charges the rate plus the fixed part, never more than the payout', () => {
    expect(payoutFee(100_000, daily, false)).toBe(800);
    expect(payoutFee(500, daily, false)).toBe(303);
    expect(payoutFee(200, daily, false)).toBe(200);
    expect(payoutFee(0, daily, false)).toBe(0);
    expect(payoutFee(-500, daily, false)).toBe(0);
  });

  it('waives the fee on a plan with fast payouts when the option says so', () => {
    expect(payoutFee(100_000, daily, true)).toBe(0);
    expect(payoutFee(100_000, { ...daily, freeWithFastPayouts: false }, true)).toBe(800);
  });

  it('splits the VAT-included fee into net and VAT for the invoice', () => {
    expect(payoutFeeInvoiceLine(1200, 2000)).toEqual({ netMinor: 1000, vatMinor: 200 });
    const odd = payoutFeeInvoiceLine(803, 2000);
    expect(odd.netMinor + odd.vatMinor).toBe(803);
  });

  it('closes the previous UTC day', () => {
    const day = previousPayoutDay(new Date('2026-10-06T08:30:00Z'));
    expect(day.periodStart.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(day.periodEnd.toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });
});
