import { z } from 'zod';
import { GeoPointSchema } from './courier';
import type { GeoPoint } from './courier';
import type { FulfillmentTypeValue, OrderStatusValue } from './delivery';
import { LocaleCodeSchema } from './i18n/locales';

/**
 * The customer's own account (docs/VITRIN.md, "Musteri hesabi"): saved
 * addresses that prefill the next delivery order and the list of orders
 * with their tracking links. A phone number is the account; signing in from
 * a table QR or the restaurant page is the same OTP as everywhere else.
 */

export const SaveAddressSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    addressLine: z.string().trim().min(5).max(300),
    city: z.string().trim().min(1).max(80),
    district: z.string().trim().min(1).max(80),
    postalCode: z.string().trim().max(16).optional(),
    note: z.string().trim().max(300).optional(),
    point: GeoPointSchema.nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();
export type SaveAddressInput = z.infer<typeof SaveAddressSchema>;

export const UpdateAddressSchema = SaveAddressSchema.partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'empty update' });
export type UpdateAddressInput = z.infer<typeof UpdateAddressSchema>;

export const UpdateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    locale: LocaleCodeSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'empty update' });
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export interface CustomerAddressDTO {
  id: string;
  label: string;
  addressLine: string;
  city: string;
  district: string;
  postalCode: string | null;
  note: string | null;
  point: GeoPoint | null;
  isDefault: boolean;
}

export interface CustomerOrderDTO {
  id: string;
  shortCode: string;
  trackingUrl: string | null;
  restaurant: { name: string; slug: string; logoUrl: string | null };
  status: OrderStatusValue;
  fulfillment: FulfillmentTypeValue;
  chargedToCustomerMinor: number;
  currency: string;
  itemCount: number;
  placedAt: string;
  completedAt: string | null;
}

export interface CustomerAccountDTO {
  user: { fullName: string; phone: string; locale: string | null };
  addresses: CustomerAddressDTO[];
  orders: CustomerOrderDTO[];
}

/** What the storefront knows about a signed-in visitor: enough to prefill, never more. */
export interface StorefrontViewerDTO {
  fullName: string;
  phone: string;
  addresses: CustomerAddressDTO[];
}
