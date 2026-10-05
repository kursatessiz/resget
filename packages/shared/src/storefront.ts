import { z } from 'zod';
import type { OrderAvailabilityDTO } from './availability';
import type { StorefrontSchedulingDTO } from './scheduling';
import type { Allergen, DietaryTag } from './allergens';
import type { OpeningHours } from './opening-hours';
import { CouponCodeSchema } from './coupons';
import { MarketingChannelsSchema } from './consent';
import { OrderSourceSchema } from './ordering-links';
import type { DeliveryZone } from './delivery-zone';
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
  /** Declared allergens and tags; empty while the allergens module is off (docs/ALERJENLER.md). */
  allergens: Allergen[];
  dietaryTags: DietaryTag[];
  modifierGroups: MenuModifierGroupDTO[];
  /** Portions left while the menu_stock module counts this item (docs/STOK.md); null otherwise. */
  stockLeft: number | null;
}

export interface StorefrontCategoryDTO {
  id: string;
  name: string;
  /** Ordering windows in the restaurant's zone while the menu_dayparts module is on; null otherwise (docs/OGUN_SAATLERI.md). */
  availableHours: OpeningHours | null;
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
  /** Radius, minimum basket and distance bands while the delivery_zones module is on; null otherwise. */
  deliveryZone: DeliveryZone | null;
  /** The restaurant takes coupon codes (module on and a plan with coupons, docs/KUPONLAR.md). */
  coupons: boolean;
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
  /** On the table page while table_tabs is on: orders can go on the open tab, and the tab already running. */
  tab: { enabled: boolean; open: { token: string; totalMinor: number; dueMinor: number } | null } | null;
  payment: AcceptedPaymentMethodsDTO;
  ordering: StorefrontOrderingDTO;
  categories: StorefrontCategoryDTO[];
  /** Loyalty rules when the restaurant runs an active program (docs/SADAKAT.md). */
  loyalty: StorefrontLoyaltyDTO | null;
  /** Whether orders are taken right now: pause, busy mode, opening hours (docs/SIPARIS_VE_SEVK.md). */
  availability: OrderAvailabilityDTO;
  /** The restaurant measures visits (docs/ATIF.md): the page shows the consent banner and the beacon. */
  tracking: boolean;
  /** Per-channel consent boxes instead of the single legacy box (docs/RIZA.md). */
  consentV2: boolean;
  /** Slots for a later order (docs/ILERI_TARIHLI_SIPARIS.md); null while the module is off or the restaurant offers none. */
  scheduling: StorefrontSchedulingDTO | null;
  /** A shared basket can be opened on the restaurant page (docs/GRUP_SIPARISI.md). */
  groupOrders: boolean;
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
    /** Omitted only for a tab order, which is paid with the tab. */
    payment: OrderPaymentIntentSchema.optional(),
    /** Put the order on the table's open tab (docs/ACIK_HESAP.md); table QR orders only. */
    tab: z.boolean().optional(),
    note: z.string().trim().max(500).optional(),
    /** Where a hosted payment page returns to; required when the chosen method is paid online. */
    returnUrl: z.string().url().optional(),
    /** Marketing consent box (docs/KAMPANYALAR.md); only true is recorded. */
    marketingOptIn: z.boolean().optional(),
    /** Per-channel consent boxes (docs/RIZA.md); used instead of marketingOptIn when the consent v2 module is on. */
    marketingChannels: MarketingChannelsSchema.optional(),
    /** Spend the signed-in customer's loyalty points on this order (docs/SADAKAT.md); the API decides how many. */
    useLoyaltyPoints: z.boolean().optional(),
    /** A coupon code (docs/KUPONLAR.md); not combined with loyalty points. */
    couponCode: CouponCodeSchema.optional(),
    /** A later slot instead of as soon as possible (docs/ILERI_TARIHLI_SIPARIS.md); one of the offered slots. */
    scheduledFor: z.string().datetime().optional(),
    /** The channel link the page was opened from (docs/SIPARIS_BAGLANTILARI.md); kept only while the module is on. */
    source: OrderSourceSchema.optional(),
  })
  .strict()
  .superRefine((order, ctx) => {
    if (order.scheduledFor && order.fulfillment === 'DINE_IN') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduledFor'],
        message: 'a table order is never scheduled',
      });
    }
    if (order.fulfillment === 'DELIVERY' && !order.address) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['address'], message: 'address is required for delivery' });
    }
    if (order.tab ? order.payment !== undefined || order.fulfillment !== 'DINE_IN' : order.payment === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment'],
        message: 'a payment method, or a table order put on the tab',
      });
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
  /** The table's bill when the order went on the open tab (docs/ACIK_HESAP.md). */
  tabUrl: string | null;
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
  /** From the branch's opening hours in the restaurant's zone; null when no hours are set. */
  isOpenNow: boolean | null;
}

/** A visitor asking for a district that is not open yet (docs/PLATFORM_YONETIMI.md, launch tools). */
export const MarketplaceInterestSchema = z
  .object({
    countryCode: CountryCodeSchema,
    city: z.string().trim().min(2).max(80),
    district: z.string().trim().min(2).max(80),
  })
  .strict();
export type MarketplaceInterestInput = z.infer<typeof MarketplaceInterestSchema>;

export interface MarketplaceInterestResultDTO {
  recorded: boolean;
  /** True when the district is already open: the page can send the visitor there instead. */
  launched: boolean;
}

export interface MarketplaceDTO {
  area: MarketplaceAreaDTO;
  restaurants: MarketplaceRestaurantDTO[];
}
