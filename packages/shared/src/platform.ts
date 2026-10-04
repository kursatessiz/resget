import { z } from 'zod';
import { PhoneSchema } from './validators';
import type { FeatureKey } from './features';
import type { PermissionKey } from './permissions';

/**
 * Platform marketing (docs/PAZARLAMA.md). The platform markets itself with
 * the same modules restaurants use, pointed at one special tenant: the
 * restaurant row with isPlatform = true. Its contacts are restaurant owners
 * and prospects. A platform marketing user is a member of that tenant on a
 * locked system role; platform permissions decide what they see under
 * /pazarlama and map onto ordinary restaurant permissions, so every tenant
 * screen works unchanged. They never reach roles, staff, money or other
 * restaurants. The super admin has every platform permission.
 */

export const PLATFORM_PERMISSION_KEYS = [
  'platform.marketing.view',
  'platform.marketing.manage',
  'platform.marketing.send',
  'platform.contacts.export',
  'platform.integrations.manage',
] as const;
export type PlatformPermissionKey = (typeof PLATFORM_PERMISSION_KEYS)[number];
export const PlatformPermissionKeySchema = z.enum(PLATFORM_PERMISSION_KEYS);

/** Restaurant permissions each platform permission grants on the platform tenant. */
export const PLATFORM_TENANT_GRANTS: Readonly<Record<PlatformPermissionKey, readonly PermissionKey[]>> = {
  'platform.marketing.view': ['customers.view', 'campaigns.view', 'reports.view'],
  'platform.marketing.manage': ['customers.manage', 'campaigns.manage'],
  'platform.marketing.send': ['campaigns.manage', 'messaging.manage'],
  'platform.contacts.export': ['customers.contact.view'],
  'platform.integrations.manage': ['integrations.manage'],
};

/** Restaurant permissions a platform role may never carry, whatever the mapping says. */
export const PLATFORM_FORBIDDEN_TENANT_PERMISSIONS: readonly PermissionKey[] = [
  'roles.manage',
  'staff.manage',
  'restaurant.settings.manage',
  'finance.view',
  'payouts.view',
  'payments.manage',
  'invoices.view',
  'subscription.manage',
];

export const PLATFORM_ROLE_KEYS = ['marketing_admin', 'marketing_editor', 'marketing_viewer'] as const;
export type PlatformRoleKey = (typeof PLATFORM_ROLE_KEYS)[number];
export const PlatformRoleKeySchema = z.enum(PLATFORM_ROLE_KEYS);

/** Platform roles as code: the console assigns them, nobody edits them. */
export const PLATFORM_ROLES: Readonly<Record<PlatformRoleKey, readonly PlatformPermissionKey[]>> = {
  marketing_admin: [
    'platform.marketing.view',
    'platform.marketing.manage',
    'platform.marketing.send',
    'platform.integrations.manage',
  ],
  marketing_editor: ['platform.marketing.view', 'platform.marketing.manage'],
  marketing_viewer: ['platform.marketing.view'],
};

/** Prefix of the locked role template that mirrors a platform role on the platform tenant. */
export const PLATFORM_ROLE_PREFIX = 'platform:';

export function platformRoleSystemKey(role: PlatformRoleKey): string {
  return `${PLATFORM_ROLE_PREFIX}${role}`;
}

export function platformRoleOf(systemKey: string | null | undefined): PlatformRoleKey | null {
  if (!systemKey?.startsWith(PLATFORM_ROLE_PREFIX)) return null;
  const key = systemKey.slice(PLATFORM_ROLE_PREFIX.length);
  return (PLATFORM_ROLE_KEYS as readonly string[]).includes(key) ? (key as PlatformRoleKey) : null;
}

/** The restaurant permissions a set of platform permissions resolves to; the forbidden ones never appear. */
export function platformTenantPermissions(granted: readonly PlatformPermissionKey[]): PermissionKey[] {
  const out = new Set<PermissionKey>();
  for (const key of granted) for (const permission of PLATFORM_TENANT_GRANTS[key]) out.add(permission);
  for (const forbidden of PLATFORM_FORBIDDEN_TENANT_PERMISSIONS) out.delete(forbidden);
  return [...out];
}

/** The marketing shell's menu (/pazarlama); labels are `marketing.nav.<key>`. */
export interface MarketingNavItem {
  key: string;
  path: string;
  permission: PlatformPermissionKey;
  feature?: FeatureKey;
}

export const MARKETING_NAV: readonly MarketingNavItem[] = [
  { key: 'overview', path: '', permission: 'platform.marketing.view' },
  { key: 'contacts', path: '/kisiler', permission: 'platform.marketing.view' },
  { key: 'pipeline', path: '/satis-hatti', permission: 'platform.marketing.view', feature: 'contacts_crm' },
  { key: 'tasks', path: '/gorevler', permission: 'platform.marketing.view', feature: 'contacts_crm' },
  { key: 'campaigns', path: '/kampanyalar', permission: 'platform.marketing.view', feature: 'campaigns' },
  { key: 'segments', path: '/segmentler', permission: 'platform.marketing.view', feature: 'segments_v2' },
  { key: 'journeys', path: '/akislar', permission: 'platform.marketing.view', feature: 'journeys' },
  { key: 'funnels', path: '/huniler', permission: 'platform.marketing.view', feature: 'kpi_dashboard' },
  { key: 'ads', path: '/reklam', permission: 'platform.marketing.view', feature: 'ad_integrations' },
  { key: 'attribution', path: '/atif', permission: 'platform.marketing.view', feature: 'attribution' },
];

export function visibleMarketingNav(
  permissions: readonly PlatformPermissionKey[],
  features: readonly FeatureKey[],
): MarketingNavItem[] {
  return MARKETING_NAV.filter(
    (item) => permissions.includes(item.permission) && (!item.feature || features.includes(item.feature)),
  );
}

// -- Console ------------------------------------------------------------------------

export const SetupPlatformTenantSchema = z
  .object({
    /** The platform's own name, as its marketing signs off (tenant data, not code). */
    name: z.string().trim().min(2).max(80),
    countryCode: z.string().length(2),
    currency: z.string().length(3),
    timezone: z.string().min(3).max(64),
    defaultLocale: z.string().min(2).max(10),
  })
  .strict();
export type SetupPlatformTenantInput = z.infer<typeof SetupPlatformTenantSchema>;

export const InvitePlatformUserSchema = z
  .object({
    phone: PhoneSchema,
    fullName: z.string().trim().min(2).max(120),
    role: PlatformRoleKeySchema,
  })
  .strict();
export type InvitePlatformUserInput = z.infer<typeof InvitePlatformUserSchema>;

export const UpdatePlatformUserSchema = z
  .object({ role: PlatformRoleKeySchema.optional(), active: z.boolean().optional() })
  .strict()
  .refine((v) => v.role !== undefined || v.active !== undefined, { message: 'Nothing to change' });
export type UpdatePlatformUserInput = z.infer<typeof UpdatePlatformUserSchema>;

export interface PlatformUserDTO {
  membershipId: string;
  userId: string;
  fullName: string;
  phoneMasked: string;
  role: PlatformRoleKey;
  active: boolean;
  createdAt: string;
}

export interface PlatformAdminDTO {
  /** Null until the console sets the platform tenant up. */
  tenant: { id: string; slug: string; currency: string; countryCode: string } | null;
  enabled: boolean;
  users: PlatformUserDTO[];
}

/** What /pazarlama learns about the signed-in person. */
export interface PlatformContextDTO {
  restaurantId: string;
  restaurantSlug: string;
  isSuperAdmin: boolean;
  role: PlatformRoleKey | null;
  permissions: PlatformPermissionKey[];
  features: FeatureKey[];
}
