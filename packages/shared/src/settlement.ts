import { z } from 'zod';
import { LedgerEntryType } from './enums';
import { BasisPointsSchema, CurrencyCodeSchema, MinorAmountSchema, bpsOf, netOfVat } from './money';

/**
 * The money trail of one order (docs/MUTABAKAT.md):
 *
 *   charged to customer -> VAT -> platform commission -> PSP fee -> withholding -> restaurant payable
 *
 * Decisions encoded here (docs/IS_MODELI.md, docs/FIYATLANDIRMA.md):
 * - The platform commission is a low fixed take rate on the gross order value
 *   (default 1 percent). It is the only revenue the marketplace takes from a sale.
 * - The payment provider (PSP) fee is passed through to the restaurant at its
 *   real, documented rate; the platform adds no hidden margin on top of it.
 * - The e-commerce withholding tax (Turkey: 1 percent of the VAT-exclusive sale
 *   price) is money the platform forwards to the tax authority on behalf of the
 *   restaurant. It is never platform revenue and its base is not reduced by the
 *   commission or the PSP fee.
 * - A third-party courier is a separately priced service. Its cost and the
 *   delivery fee collected from the customer flow to whoever bears it; it never
 *   hides inside the commission.
 *
 * All amounts are integers in the currency's minor unit; rounding happens once
 * per line, half up. The identity below holds for every input and is checked
 * in settlement.spec.ts:
 *
 *   chargedToCustomer = restaurantPayable + withholding + pspFee + courierCost + platformNet + commissionVat
 */

export const PLATFORM_COMMISSION_BPS = 100;

/** Regional defaults; the tenant's country selects a row, anything else falls back to DEFAULT. */
export const SETTLEMENT_DEFAULTS_BY_COUNTRY: Readonly<
  Record<string, { withholdingBps: number; commissionVatBps: number }>
> = {
  TR: { withholdingBps: 100, commissionVatBps: 2000 },
  DEFAULT: { withholdingBps: 0, commissionVatBps: 0 },
};

export function settlementDefaultsFor(countryCode: string): { withholdingBps: number; commissionVatBps: number } {
  return SETTLEMENT_DEFAULTS_BY_COUNTRY[countryCode.toUpperCase()] ?? SETTLEMENT_DEFAULTS_BY_COUNTRY.DEFAULT;
}

/**
 * VAT rate applied to the delivery fee line of an order, by country. Kept
 * apart from settlementDefaultsFor so that object stays a valid spread into
 * SettlementInput. Turkey: delivery is a service taxed at the standard rate.
 */
export const DELIVERY_FEE_VAT_BPS_BY_COUNTRY: Readonly<Record<string, number>> = { TR: 2000, DEFAULT: 0 };

export function deliveryFeeVatBpsFor(countryCode: string): number {
  return DELIVERY_FEE_VAT_BPS_BY_COUNTRY[countryCode.toUpperCase()] ?? DELIVERY_FEE_VAT_BPS_BY_COUNTRY.DEFAULT;
}

export const FeeBearerSchema = z.enum(['RESTAURANT', 'PLATFORM']);
export type FeeBearer = z.infer<typeof FeeBearerSchema>;

export const SettlementLineSchema = z
  .object({
    /** Gross amount including VAT. */
    amountMinor: MinorAmountSchema,
    vatRateBps: BasisPointsSchema,
  })
  .strict();
export type SettlementLine = z.infer<typeof SettlementLineSchema>;

export const SettlementInputSchema = z
  .object({
    currency: CurrencyCodeSchema,
    items: z.array(SettlementLineSchema).min(1),
    /** Delivery fee charged to the customer, if any. */
    deliveryFee: SettlementLineSchema.nullable().optional(),
    /** Discount taken off the customer's bill and who funds it. */
    discount: z.object({ amountMinor: MinorAmountSchema, fundedBy: FeeBearerSchema }).strict().nullable().optional(),
    commissionBps: BasisPointsSchema.default(PLATFORM_COMMISSION_BPS),
    /** VAT the platform invoices on its commission; deducted from the payout like the commission itself. */
    commissionVatBps: BasisPointsSchema.default(0),
    psp: z
      .object({
        percentBps: BasisPointsSchema,
        fixedMinor: MinorAmountSchema.default(0),
        bearer: FeeBearerSchema.default('RESTAURANT'),
      })
      .strict(),
    withholdingBps: BasisPointsSchema.default(0),
    /** Cost of a third-party courier and who pays it; the delivery fee goes to the same party. */
    courier: z.object({ costMinor: MinorAmountSchema, bearer: FeeBearerSchema }).strict().nullable().optional(),
  })
  .strict();
export type SettlementInput = z.input<typeof SettlementInputSchema>;

export interface SettlementLedgerLine {
  type: LedgerEntryType;
  /** Signed from the restaurant's point of view: positive is owed to the restaurant. */
  amountMinor: number;
}

export interface Settlement {
  currency: string;
  /** What the customer actually paid: items + delivery fee - discount. */
  chargedToCustomerMinor: number;
  itemsGrossMinor: number;
  itemsNetOfVatMinor: number;
  itemsVatMinor: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  discountFundedBy: FeeBearer | null;
  /** Base of the commission and of the withholding: items after a restaurant-funded discount. */
  commissionBaseMinor: number;
  platformCommissionMinor: number;
  commissionVatMinor: number;
  pspFeeMinor: number;
  pspFeeBearer: FeeBearer;
  withholdingBaseMinor: number;
  withholdingMinor: number;
  courierCostMinor: number;
  courierBearer: FeeBearer | null;
  /** What the restaurant receives in the payout. */
  restaurantPayableMinor: number;
  /** Platform revenue: the commission plus the delivery fee when the platform bears the courier. */
  platformRevenueMinor: number;
  /** Platform revenue after the costs the platform bears (PSP, courier, platform-funded discount). */
  platformNetMinor: number;
  /** Statement lines for the restaurant, summing to restaurantPayableMinor. */
  ledger: SettlementLedgerLine[];
}

export function computeOrderSettlement(raw: SettlementInput): Settlement {
  const input = SettlementInputSchema.parse(raw);

  const itemsGrossMinor = input.items.reduce((sum, line) => sum + line.amountMinor, 0);
  const itemsNetOfVatMinor = input.items.reduce((sum, line) => sum + netOfVat(line.amountMinor, line.vatRateBps), 0);
  const itemsVatMinor = itemsGrossMinor - itemsNetOfVatMinor;

  const deliveryFeeMinor = input.deliveryFee?.amountMinor ?? 0;
  const discountMinor = input.discount?.amountMinor ?? 0;
  const discountFundedBy = input.discount ? input.discount.fundedBy : null;
  if (discountMinor > itemsGrossMinor) throw new RangeError('discount cannot exceed the items total');

  const chargedToCustomerMinor = itemsGrossMinor + deliveryFeeMinor - discountMinor;

  const restaurantDiscount = discountFundedBy === 'RESTAURANT' ? discountMinor : 0;
  const platformDiscount = discountFundedBy === 'PLATFORM' ? discountMinor : 0;
  const commissionBaseMinor = itemsGrossMinor - restaurantDiscount;
  const platformCommissionMinor = bpsOf(commissionBaseMinor, input.commissionBps);
  const commissionVatMinor = bpsOf(platformCommissionMinor, input.commissionVatBps);

  const pspFeeMinor =
    chargedToCustomerMinor === 0 ? 0 : bpsOf(chargedToCustomerMinor, input.psp.percentBps) + input.psp.fixedMinor;
  const pspFeeBearer = input.psp.bearer;

  // Withholding applies to the VAT-exclusive sale price the restaurant realised;
  // the discount the restaurant funded lowers it, platform fees never do.
  const withholdingBaseMinor = Math.max(
    0,
    itemsNetOfVatMinor - netOfVatOfDiscount(input.items, restaurantDiscount, itemsGrossMinor),
  );
  const withholdingMinor = bpsOf(withholdingBaseMinor, input.withholdingBps);

  const courierCostMinor = input.courier?.costMinor ?? 0;
  const courierBearer = input.courier ? input.courier.bearer : null;
  const restaurantMovesFood = courierBearer !== 'PLATFORM';

  const ledger: SettlementLedgerLine[] = [{ type: LedgerEntryType.GROSS_SALE, amountMinor: itemsGrossMinor }];
  if (restaurantDiscount > 0) ledger.push({ type: LedgerEntryType.DISCOUNT, amountMinor: -restaurantDiscount });
  if (restaurantMovesFood && deliveryFeeMinor > 0)
    ledger.push({ type: LedgerEntryType.DELIVERY_FEE, amountMinor: deliveryFeeMinor });
  if (restaurantMovesFood && courierCostMinor > 0)
    ledger.push({ type: LedgerEntryType.COURIER_COST, amountMinor: -courierCostMinor });
  if (platformCommissionMinor > 0)
    ledger.push({ type: LedgerEntryType.PLATFORM_COMMISSION, amountMinor: -platformCommissionMinor });
  if (commissionVatMinor > 0) ledger.push({ type: LedgerEntryType.COMMISSION_VAT, amountMinor: -commissionVatMinor });
  if (pspFeeBearer === 'RESTAURANT' && pspFeeMinor > 0)
    ledger.push({ type: LedgerEntryType.PSP_FEE, amountMinor: -pspFeeMinor });
  if (withholdingMinor > 0) ledger.push({ type: LedgerEntryType.WITHHOLDING_TAX, amountMinor: -withholdingMinor });

  const restaurantPayableMinor = ledger.reduce((sum, line) => sum + line.amountMinor, 0);
  ledger.push({ type: LedgerEntryType.RESTAURANT_PAYABLE, amountMinor: restaurantPayableMinor });

  const platformRevenueMinor = platformCommissionMinor + (courierBearer === 'PLATFORM' ? deliveryFeeMinor : 0);
  const platformNetMinor =
    platformRevenueMinor -
    (pspFeeBearer === 'PLATFORM' ? pspFeeMinor : 0) -
    (courierBearer === 'PLATFORM' ? courierCostMinor : 0) -
    platformDiscount;

  return {
    currency: input.currency,
    chargedToCustomerMinor,
    itemsGrossMinor,
    itemsNetOfVatMinor,
    itemsVatMinor,
    deliveryFeeMinor,
    discountMinor,
    discountFundedBy,
    commissionBaseMinor,
    platformCommissionMinor,
    commissionVatMinor,
    pspFeeMinor,
    pspFeeBearer,
    withholdingBaseMinor,
    withholdingMinor,
    courierCostMinor,
    courierBearer,
    restaurantPayableMinor,
    platformRevenueMinor,
    platformNetMinor,
    ledger,
  };
}

/** The VAT-exclusive share of a restaurant-funded discount, spread over the lines in proportion to their gross. */
function netOfVatOfDiscount(items: SettlementLine[], discountMinor: number, itemsGrossMinor: number): number {
  if (discountMinor === 0 || itemsGrossMinor === 0) return 0;
  if (items.length === 1) return netOfVat(discountMinor, items[0].vatRateBps);
  let allocated = 0;
  let net = 0;
  items.forEach((line, index) => {
    const share =
      index === items.length - 1
        ? discountMinor - allocated
        : Math.round((discountMinor * line.amountMinor) / itemsGrossMinor);
    allocated += share;
    net += netOfVat(share, line.vatRateBps);
  });
  return net;
}

/** The viability figure the business model turns on: platform contribution per order after its own variable costs. */
export function contributionPerOrder(settlement: Settlement, platformVariableCostMinor: number): number {
  return settlement.platformNetMinor - platformVariableCostMinor;
}
