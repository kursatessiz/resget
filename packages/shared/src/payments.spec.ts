import { LedgerEntryType, PaymentMode } from './enums';
import {
  ConnectOwnPosSchema,
  buildCommissionStatement,
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
