import { z } from 'zod';
import { DeliveryMode } from './enums';
import { DeliveryFeePolicySchema } from './courier';
import type { DeliveryFeePolicy } from './courier';
import { DispatchSettingsSchema } from './delivery';
import type { DispatchSettings } from './delivery';
import { LocaleCodeSchema } from './i18n/locales';
import type { PaymentModeValue } from './payments';
import type { PermissionKey } from './permissions';
import type { PlanCode } from './plans';

/**
 * Restaurant settings the owner edits in the panel. Commission, payment
 * fees, listing and the service area are platform data and stay out of
 * this schema; the super admin changes them.
 */

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'hex color expected');

export const UpdateRestaurantSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    legalName: z.string().trim().max(160).nullable().optional(),
    taxId: z.string().trim().max(32).nullable().optional(),
    defaultLocale: LocaleCodeSchema.optional(),
    logoUrl: z.string().trim().url().max(500).nullable().optional(),
    themePrimary: HexColorSchema.optional(),
    deliveryMode: z.nativeEnum(DeliveryMode).optional(),
    deliveryFeePolicy: DeliveryFeePolicySchema.nullable().optional(),
    dispatchSettings: DispatchSettingsSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'empty update' });
export type UpdateRestaurantSettingsInput = z.infer<typeof UpdateRestaurantSettingsSchema>;

export interface RestaurantBranchDTO {
  id: string;
  name: string;
  city: string | null;
  district: string | null;
}

/** GET /restaurants/:id for a member of the restaurant. */
export interface RestaurantSettingsDTO {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  countryCode: string;
  currency: string;
  timezone: string;
  defaultLocale: string;
  isListed: boolean;
  /** Marketplace listing review state (docs/PLATFORM_YONETIMI.md). */
  listingRequestedAt: string | null;
  listingReviewedAt: string | null;
  listingReviewNote: string | null;
  commissionBps: number;
  paymentMode: PaymentModeValue;
  pspPercentBps: number;
  pspFixedMinor: number;
  deliveryMode: `${DeliveryMode}`;
  courierProviderId: string | null;
  deliveryFeePolicy: DeliveryFeePolicy | null;
  dispatchSettings: DispatchSettings;
  logoUrl: string | null;
  themePrimary: string;
  branches: RestaurantBranchDTO[];
  effectivePlan: PlanCode;
  permissions: PermissionKey[];
}
