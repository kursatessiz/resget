import { LedgerEntryType } from './enums';
import { commissionBpsFor, computeOrderSettlement, contributionPerOrder, settlementDefaultsFor } from './settlement';
import type { Settlement, SettlementInput } from './settlement';

function assertIdentity(s: Settlement): void {
  expect(s.chargedToCustomerMinor).toBe(
    s.restaurantPayableMinor +
      s.withholdingMinor +
      s.pspFeeMinor +
      s.courierCostMinor +
      s.platformNetMinor +
      s.commissionVatMinor,
  );
  const payableLine = s.ledger.find((l) => l.type === LedgerEntryType.RESTAURANT_PAYABLE);
  expect(payableLine?.amountMinor).toBe(s.restaurantPayableMinor);
  const sumWithoutPayable = s.ledger
    .filter((l) => l.type !== LedgerEntryType.RESTAURANT_PAYABLE)
    .reduce((n, l) => n + l.amountMinor, 0);
  expect(sumWithoutPayable).toBe(s.restaurantPayableMinor);
}

describe('computeOrderSettlement', () => {
  it('500 TL order, 1 percent commission, 2 percent PSP borne by the restaurant (feasibility example)', () => {
    const s = computeOrderSettlement({
      currency: 'TRY',
      items: [{ amountMinor: 50000, vatRateBps: 1000 }],
      psp: { percentBps: 200, bearer: 'RESTAURANT' },
      withholdingBps: 0,
    });
    expect(s.platformCommissionMinor).toBe(500);
    expect(s.pspFeeMinor).toBe(1000);
    expect(s.restaurantPayableMinor).toBe(48500);
    expect(s.platformRevenueMinor).toBe(500);
    expect(s.platformNetMinor).toBe(500);
    assertIdentity(s);
  });

  it('applies Turkish withholding on the VAT-exclusive price, not reduced by fees', () => {
    const tr = settlementDefaultsFor('tr');
    const s = computeOrderSettlement({
      currency: 'TRY',
      // 1.000 TL excluding VAT at 10 percent = 1.100 TL gross
      items: [{ amountMinor: 110000, vatRateBps: 1000 }],
      psp: { percentBps: 200, bearer: 'RESTAURANT' },
      ...tr,
    });
    expect(s.itemsNetOfVatMinor).toBe(100000);
    expect(s.itemsVatMinor).toBe(10000);
    expect(s.withholdingBaseMinor).toBe(100000);
    expect(s.withholdingMinor).toBe(1000);
    expect(s.platformCommissionMinor).toBe(1100);
    expect(s.commissionVatMinor).toBe(220);
    expect(s.pspFeeMinor).toBe(2200);
    expect(s.restaurantPayableMinor).toBe(110000 - 1100 - 220 - 2200 - 1000);
    assertIdentity(s);
  });

  it('keeps a third-party courier outside the commission: restaurant bears it', () => {
    const s = computeOrderSettlement({
      currency: 'TRY',
      items: [{ amountMinor: 70000, vatRateBps: 1000 }],
      deliveryFee: { amountMinor: 4000, vatRateBps: 2000 },
      psp: { percentBps: 200, fixedMinor: 25, bearer: 'RESTAURANT' },
      courier: { costMinor: 4500, bearer: 'RESTAURANT' },
    });
    expect(s.chargedToCustomerMinor).toBe(74000);
    expect(s.platformCommissionMinor).toBe(700);
    expect(s.pspFeeMinor).toBe(1480 + 25);
    expect(s.ledger.map((l) => l.type)).toEqual([
      LedgerEntryType.GROSS_SALE,
      LedgerEntryType.DELIVERY_FEE,
      LedgerEntryType.COURIER_COST,
      LedgerEntryType.PLATFORM_COMMISSION,
      LedgerEntryType.PSP_FEE,
      LedgerEntryType.RESTAURANT_PAYABLE,
    ]);
    expect(s.restaurantPayableMinor).toBe(70000 + 4000 - 4500 - 700 - 1505);
    expect(s.platformRevenueMinor).toBe(700);
    assertIdentity(s);
  });

  it('platform-borne courier: the fee is platform revenue and the cost a platform expense', () => {
    const s = computeOrderSettlement({
      currency: 'TRY',
      items: [{ amountMinor: 70000, vatRateBps: 1000 }],
      deliveryFee: { amountMinor: 4000, vatRateBps: 2000 },
      psp: { percentBps: 200, bearer: 'PLATFORM' },
      courier: { costMinor: 4500, bearer: 'PLATFORM' },
    });
    expect(s.restaurantPayableMinor).toBe(70000 - 700);
    expect(s.platformRevenueMinor).toBe(700 + 4000);
    expect(s.platformNetMinor).toBe(700 + 4000 - 1480 - 4500);
    expect(s.ledger.some((l) => l.type === LedgerEntryType.PSP_FEE)).toBe(false);
    assertIdentity(s);
  });

  it('restaurant-funded discount lowers the commission and withholding base; platform-funded does not', () => {
    const base: SettlementInput = {
      currency: 'EUR',
      items: [{ amountMinor: 10000, vatRateBps: 700 }],
      psp: { percentBps: 150, bearer: 'RESTAURANT' },
      withholdingBps: 100,
    };
    const byRestaurant = computeOrderSettlement({ ...base, discount: { amountMinor: 2000, fundedBy: 'RESTAURANT' } });
    const byPlatform = computeOrderSettlement({ ...base, discount: { amountMinor: 2000, fundedBy: 'PLATFORM' } });
    expect(byRestaurant.commissionBaseMinor).toBe(8000);
    expect(byRestaurant.platformCommissionMinor).toBe(80);
    expect(byRestaurant.withholdingBaseMinor).toBe(9346 - 1869);
    expect(byPlatform.commissionBaseMinor).toBe(10000);
    expect(byPlatform.platformCommissionMinor).toBe(100);
    expect(byPlatform.withholdingBaseMinor).toBe(9346);
    // The platform tops up what the customer did not pay.
    expect(byPlatform.restaurantPayableMinor).toBe(10000 - 100 - 120 - 93);
    expect(byPlatform.platformNetMinor).toBe(100 - 2000);
    assertIdentity(byRestaurant);
    assertIdentity(byPlatform);
  });

  it('spreads a discount over mixed VAT lines and keeps the identity', () => {
    const s = computeOrderSettlement({
      currency: 'TRY',
      items: [
        { amountMinor: 33333, vatRateBps: 1000 },
        { amountMinor: 6667, vatRateBps: 2000 },
        { amountMinor: 1, vatRateBps: 0 },
      ],
      deliveryFee: { amountMinor: 999, vatRateBps: 2000 },
      discount: { amountMinor: 1234, fundedBy: 'RESTAURANT' },
      psp: { percentBps: 219, fixedMinor: 25, bearer: 'RESTAURANT' },
      withholdingBps: 100,
      commissionVatBps: 2000,
      courier: { costMinor: 3000, bearer: 'RESTAURANT' },
    });
    assertIdentity(s);
    expect(s.withholdingBaseMinor).toBeLessThan(s.itemsNetOfVatMinor);
  });

  it('rejects a discount larger than the items and non-integer amounts', () => {
    expect(() =>
      computeOrderSettlement({
        currency: 'TRY',
        items: [{ amountMinor: 100, vatRateBps: 0 }],
        discount: { amountMinor: 101, fundedBy: 'RESTAURANT' },
        psp: { percentBps: 0 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      computeOrderSettlement({
        currency: 'TRY',
        items: [{ amountMinor: 10.5, vatRateBps: 0 }],
        psp: { percentBps: 0 },
      }),
    ).toThrow();
  });

  it('contribution per order is platform net minus the platform variable cost', () => {
    const s = computeOrderSettlement({
      currency: 'TRY',
      items: [{ amountMinor: 70000, vatRateBps: 1000 }],
      psp: { percentBps: 200 },
    });
    expect(contributionPerOrder(s, 100)).toBe(600);
  });

  it('falls back to no withholding and no commission VAT outside the known regions', () => {
    expect(settlementDefaultsFor('DE')).toEqual({ withholdingBps: 0, commissionVatBps: 0 });
  });
});

describe('commission by fulfillment', () => {
  it('takes the restaurant rate for delivery and pickup and none for dine-in', () => {
    expect(commissionBpsFor('DELIVERY', 100)).toBe(100);
    expect(commissionBpsFor('PICKUP', 150)).toBe(150);
    expect(commissionBpsFor('DINE_IN', 100)).toBe(0);
  });
});
