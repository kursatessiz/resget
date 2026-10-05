import { z } from 'zod';

/**
 * Permission catalogue: the single source of permission keys. Role templates
 * store subsets of these keys, every API endpoint declares one of them with
 * @RequirePermission, and UI menus render from the effective set. The human
 * readable name of a key is the i18n message `permissions.<key>`.
 *
 * Adding a key is backwards compatible. Renaming or removing one needs a
 * migration of role_template_permissions.
 */
export const PERMISSION_KEYS = [
  'restaurant.settings.view',
  'restaurant.settings.manage',
  'roles.manage',
  'staff.manage',
  'branches.manage',

  'menu.view',
  'menu.manage',
  'tables.manage',

  'orders.view',
  'orders.manage',
  'orders.refund',

  'customers.view',
  'customers.contact.view',
  'customers.manage',

  'finance.view',
  'payouts.view',
  'payments.manage',
  'invoices.view',
  'subscription.manage',
  'messaging.manage',

  'campaigns.view',
  'campaigns.manage',
  'campaigns.approve',
  'loyalty.view',
  'loyalty.manage',
  'reports.view',
  'courier.manage',
  'dispatch.view',
  'dispatch.manage',
  'courier.deliver',
  'integrations.manage',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export const ALL_PERMISSIONS: readonly PermissionKey[] = PERMISSION_KEYS;

export const PermissionKeySchema = z.enum(PERMISSION_KEYS);

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

/**
 * Role templates every new restaurant starts with. The owner template is
 * immutable and always holds every permission; the others are editable
 * tenant data seeded from here. Names are i18n keys (`roles.default.<key>`).
 */
export const DEFAULT_ROLE_TEMPLATES = [
  { key: 'owner', isOwner: true, permissions: ALL_PERMISSIONS },
  {
    key: 'manager',
    isOwner: false,
    permissions: [
      'restaurant.settings.view',
      'staff.manage',
      'menu.view',
      'menu.manage',
      'tables.manage',
      'orders.view',
      'orders.manage',
      'orders.refund',
      'customers.view',
      'customers.contact.view',
      'customers.manage',
      'finance.view',
      'payouts.view',
      'invoices.view',
      'messaging.manage',
      'campaigns.view',
      'campaigns.manage',
      'loyalty.view',
      'loyalty.manage',
      'reports.view',
      'courier.manage',
      'dispatch.view',
      'dispatch.manage',
    ] satisfies PermissionKey[],
  },
  {
    key: 'counter',
    isOwner: false,
    permissions: [
      'menu.view',
      'orders.view',
      'orders.manage',
      'customers.view',
      'courier.manage',
      'dispatch.view',
      'dispatch.manage',
    ] satisfies PermissionKey[],
  },
  {
    key: 'kitchen',
    isOwner: false,
    permissions: ['menu.view', 'orders.view', 'orders.manage'] satisfies PermissionKey[],
  },
  /** The restaurant's own courier: sees and drives only the trips assigned to them. */
  {
    key: 'courier',
    isOwner: false,
    permissions: ['orders.view', 'courier.deliver'] satisfies PermissionKey[],
  },
] as const;

export type DefaultRoleTemplateKey = (typeof DEFAULT_ROLE_TEMPLATES)[number]['key'];

/** The effective permission set of a membership: owners hold everything, others what their template grants. */
export function effectivePermissions(isOwner: boolean, granted: readonly string[]): Set<PermissionKey> {
  if (isOwner) return new Set(ALL_PERMISSIONS);
  return new Set(granted.filter(isPermissionKey));
}
