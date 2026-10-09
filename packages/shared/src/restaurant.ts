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
import type { EntitlementKey } from './entitlements';

/**
 * Restaurant settings the owner edits in the panel. Commission, payment
 * fees, listing and the service area are platform data and stay out of
 * this schema; the super admin changes them.
 */

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'hex color expected');

/**
 * A host name the restaurant owns for its ordering page (docs/VITRIN.md, "Kendi alan adı"):
 * lower case, at least two labels, no scheme, no path. The platform's own host is refused by the API.
 */
export const HostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4)
  .max(253)
  .regex(/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'host name expected');

export const SetCustomDomainSchema = z.object({ domain: HostnameSchema.nullable() }).strict();
export type SetCustomDomainInput = z.infer<typeof SetCustomDomainSchema>;

/** GET /restaurants/:id/domain: what is set, whether DNS points here yet, and what to tell the registrar. */
export interface CustomDomainDTO {
  domain: string | null;
  verifiedAt: string | null;
  /** The CNAME target: the platform's web host. */
  target: string;
  /** Verified and the plan carries `custom_domain`; only then does the host serve the page. */
  active: boolean;
  /** Records the last verification saw, so the owner can compare with the registrar. */
  lastCheck: { ok: boolean; seen: string[]; ownershipProven?: boolean } | null;
  /**
   * The TXT record proving the host belongs to this restaurant (docs/VITRIN.md): pointing the host at the
   * platform alone is not enough, so another business cannot claim a domain that already reaches us.
   */
  challenge: { name: string; value: string } | null;
}

export interface PublicDomainResolveDTO {
  slug: string;
}

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
  /** Own host of the ordering page (docs/VITRIN.md); verifiedAt is set once DNS points here. */
  customDomain: string | null;
  customDomainVerifiedAt: string | null;
  branches: RestaurantBranchDTO[];
  effectivePlan: PlanCode;
  planName: string;
  entitlements: EntitlementKey[];
  permissions: PermissionKey[];
}
