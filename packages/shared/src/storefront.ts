import { z } from 'zod';
import type { StorefrontLoyaltyDTO } from './loyalty';
import type { RatingSummaryDTO } from './ratings';
import type { DeliveryFeePolicy } from './courier';
import { AddressSnapshotSchema, FulfillmentTypeValueSchema, OrderLineInputSchema } from './delivery';
import type { FulfillmentTypeValue, OrderStatusValue } from './delivery';
import { OrderPaymentIntentSchema } from './meal-cards';
import type { AcceptedPaymentMethodsDTO } from './meal-cards';
import type { MenuModifierGroupDTO } from './menu';
import { PhoneSchema } from './validators';
import { CountryCodeSchema } from './validators';

/**
 * The consumer surface (docs/VITRIN.md): the page behind a table QR, the
 * restaurant's own ordering page at /<slug> and the district marketplace.
 * Orders placed here go through the same creation path as staff orders;
 * the server decides branch, prices, fees and the initial status.
 */

export interface StorefrontItemDTO {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  isAvailable: boolean;
  imageUrl: string | null;
  modifierGroups: MenuModifierGroupDTO[];
}

export interface StorefrontCategoryDTO {
  id: string;
  name: string;
  items: StorefrontItemDTO[];
}

/** What a guest can do here; the restaurant's delivery mode and the table decide. */
export interface StorefrontOrderingDTO {
  dineIn: boolean;
  pickup: boolean;
  delivery: boolean;
  /** How the customer's delivery fee is derived; null means no fee is charged. */
  deliveryFeePolicy: DeliveryFeePolicy | null;
  /** True when the fee comes from a courier network quote at order time. */
  quotedDelivery: boolean;
  defaultPrepMinutes: number;
}

export interface StorefrontDTO {
  restaurant: {
    id: string;
    slug: string;
    name: string;
    currency: string;
    logoUrl: string | null;
    themePrimary: string;
    defaultLocale: string;
  };
  table: { id: string; label: string } | null;
  payment: AcceptedPaymentMethodsDTO;
  ordering: StorefrontOrderingDTO;
  categories: StorefrontCategoryDTO[];
  /** Loyalty rules when the restaurant runs an active program (docs/SADAKAT.md). */
  loyalty: StorefrontLoyaltyDTO | null;
}

export const PublicOrderSchema = z
  .object({
    fulfillment: FulfillmentTypeValueSchema,
    items: z.array(OrderLineInputSchema).min(1).max(100),
    customer: z
      .object({ fullName: z.string().trim().min(1).max(120), phone: PhoneSchema })
      .strict()
      .optional(),
    address: AddressSnapshotSchema.optional(),
    payment: OrderPaymentIntentSchema,
    note: z.string().trim().max(500).optional(),
    /** Where a hosted payment page returns to; required when the chosen method is paid online. */
    returnUrl: z.string().url().optional(),
    /** Marketing consent box (docs/KAMPANYALAR.md); only true is recorded. */
    marketingOptIn: z.boolean().optional(),
    /** Spend the signed-in customer's loyalty points on this order (docs/SADAKAT.md); the API decides how many. */
    useLoyaltyPoints: z.boolean().optional(),
  })
  .strict()
  .superRefine((order, ctx) => {
    if (order.fulfillment === 'DELIVERY' && !order.address) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['address'], message: 'address is required for delivery' });
    }
    if (order.fulfillment !== 'DINE_IN' && !order.customer && !order.address) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customer'], message: 'name and phone are required' });
    }
  });
export type PublicOrderInput = z.infer<typeof PublicOrderSchema>;

export interface PublicOrderResultDTO {
  trackingToken: string;
  trackingUrl: string;
  shortCode: string;
  status: OrderStatusValue;
  fulfillment: FulfillmentTypeValue;
  chargedToCustomerMinor: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  /** Points this order spent; 0 when none were used. */
  loyaltyPointsRedeemed: number;
  currency: string;
  /** Hosted payment page when the order waits for an online payment; the browser goes there next. */
  checkoutUrl: string | null;
}

export const StartedOrderSchema = z.object({ outcome: z.literal('STARTED_ORDER') }).strict();

export const MarketplaceQuerySchema = z
  .object({
    countryCode: CountryCodeSchema,
    city: z.string().trim().min(1).max(80),
    district: z.string().trim().min(1).max(80),
  })
  .strict();
export type MarketplaceQuery = z.infer<typeof MarketplaceQuerySchema>;

export interface MarketplaceAreaDTO {
  countryCode: string;
  city: string;
  district: string;
}

export interface MarketplaceRestaurantDTO {
  slug: string;
  name: string;
  logoUrl: string | null;
  themePrimary: string;
  city: string | null;
  district: string | null;
  delivery: boolean;
  pickup: boolean;
  /** Customer ratings so far; null until the first one. */
  rating: RatingSummaryDTO | null;
}

export interface MarketplaceDTO {
  area: MarketplaceAreaDTO;
  restaurants: MarketplaceRestaurantDTO[];
}
