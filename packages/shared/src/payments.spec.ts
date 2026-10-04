import { LedgerEntryType, PaymentMode } from './enums';
import {
  ConnectOwnPosSchema,
  applyCommissionCredits,
  buildCommissionStatement,
  commissionReversalLines,
  commissionDueAt,
  commissionPeriod,
  computeModeSettlement,
  quickCommission,
} from './payments';
import { settlementDefaultsFor } from './settlement';

const order = {
  currency: 'TRY',
  items: [{ amountMinor: 70000, vatRateBps: 1000 }],
  psp: { percentBps: 200, fixedMinor: 25, bearer: 'RESTAURANT' as const },
  ...settlementDefaultsFor('TR'),
};

describe('computeModeSettlement', () => {
  it('OWN_POS: no PSP fee, no withholding, commission plus VAT becomes a receivable and nothing is paid out', () => {
    const s = computeModeSettlement(PaymentMode.OWN_POS, order);
    expect(s.pspFeeMinor).toBe(0);
    expect(s.withholdingMinor).toBe(0);
    expect(s.platformCommissionMinor).toBe(700);
    expect(s.commissionVatMinor).toBe(140);
    expect(s.platformReceivableMinor).toBe(840);
    expect(s.payoutMinor).toBe(0);
    // The restaurant already holds the 700 TL; the statement shows 700 - 8,40 as its net of this order.
    expect(s.restaurantPayableMinor).toBe(70000 - 840);
    expect(s.ledger.some((l) => l.type === LedgerEntryType.PSP_FEE)).toBe(false);
  });

  it('PLATFORM_PSP: the full engine applies and the payout is the restaurant payable', () => {
    const s = computeModeSettlement(PaymentMode.PLATFORM_PSP, order);
    expect(s.pspFeeMinor).toBe(1425);
    expect(s.withholdingMinor).toBe(636);
    expect(s.platformReceivableMinor).toBe(0);
    expect(s.payoutMinor).toBe(s.restaurantPayableMinor);
    expect(s.payoutMinor).toBe(70000 - 700 - 140 - 1425 - 636);
  });
});

describe('commission statement', () => {
  it('sums snapshotted lines of a UTC month', () => {
    const period = commissionPeriod(2026, 10);
    expect(period.periodStart.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    const statement = buildCommissionStatement('TRY', period, [
      { orderId: 'a', baseMinor: 70000, commissionMinor: 700, commissionVatMinor: 140 },
      { orderId: 'b', baseMinor: 30000, commissionMinor: 300, commissionVatMinor: 60 },
    ]);
    expect(statement.orderCount).toBe(2);
    expect(statement.baseMinor).toBe(100000);
    expect(statement.commissionMinor).toBe(1000);
    expect(statement.vatMinor).toBe(200);
    expect(statement.totalMinor).toBe(1200);
  });

  it('nets the credits of refunded or charged-back orders billed on an earlier invoice', () => {
    const period = commissionPeriod(2026, 11);
    const statement = buildCommissionStatement(
      'TRY',
      period,
      [{ orderId: 'a', baseMinor: 70000, commissionMinor: 700, commissionVatMinor: 140 }],
      [{ orderId: 'old', baseMinor: 30000, commissionMinor: 300, commissionVatMinor: 60 }],
    );
    expect(statement.orderCount).toBe(1);
    expect(statement).toMatchObject({
      commissionMinor: 400,
      vatMinor: 80,
      totalMinor: 480,
      creditCommissionMinor: 300,
      creditVatMinor: 60,
    });
    expect(statement.credits.map((c) => c.orderId)).toEqual(['old']);
  });

  it('applies whole credits, oldest first, only while they stay below the charges', () => {
    const line = (orderId: string, commissionMinor: number) => ({
      orderId,
      baseMinor: commissionMinor * 100,
      commissionMinor,
      commissionVatMinor: commissionMinor / 5,
    });
    const charges = [line('a', 500), line('b', 500)]; // 1200 with VAT
    const { applied, carried } = applyCommissionCredits(charges, [line('x', 400), line('y', 500), line('z', 100)]);
    // x (480) fits, y (600) would reach 1080 and fits, z (120) would reach 1200, which is not below the charges.
    expect(applied.map((c) => c.orderId)).toEqual(['x', 'y']);
    expect(carried.map((c) => c.orderId)).toEqual(['z']);
    expect(applyCommissionCredits([], [line('x', 1)]).applied).toEqual([]);
  });

  it('gives the commission and its VAT back as payable lines', () => {
    expect(commissionReversalLines({ platformCommissionMinor: 700, commissionVatMinor: 140 })).toEqual([
      { type: 'COMMISSION_REVERSAL', amountMinor: 700 },
      { type: 'COMMISSION_VAT_REVERSAL', amountMinor: 140 },
    ]);
    expect(commissionReversalLines({ platformCommissionMinor: 0, commissionVatMinor: 0 })).toEqual([]);
  });

  it('computes the due date and the quick commission', () => {
    expect(commissionDueAt(new Date('2026-11-01T00:00:00Z'), 10).toISOString()).toBe('2026-11-11T00:00:00.000Z');
    expect(quickCommission(70000, 100, 2000)).toEqual({ commissionMinor: 700, vatMinor: 140 });
  });
});

describe('ConnectOwnPosSchema', () => {
  it('requires the provider fields and refuses unknown ones', () => {
    expect(
      ConnectOwnPosSchema.safeParse({
        providerCode: 'PAYTR',
        credentials: { merchantId: '1', merchantKey: 'k', merchantSalt: 's' },
      }).success,
    ).toBe(true);
    const missing = ConnectOwnPosSchema.safeParse({ providerCode: 'PAYTR', credentials: { merchantId: '1' } });
    expect(missing.success).toBe(false);
    const unknown = ConnectOwnPosSchema.safeParse({
      providerCode: 'MOCK',
      credentials: { merchantId: '1', cardNumber: '4111' },
    });
    expect(unknown.success).toBe(false);
  });
});
