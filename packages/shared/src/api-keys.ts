import { z } from 'zod';
import type { PermissionKey } from './permissions';

/**
 * API access for PRO restaurants (docs/API_ERISIMI.md): a restaurant's own
 * systems (POS, ERP, a website) call the same restaurant-scoped endpoints the
 * panel uses, with a key instead of a session. A key carries a subset of the
 * permission catalogue chosen at creation and never more than its creator
 * held; the plan feature `api_access` gates both minting and using keys.
 */

export const API_KEY_HEADER = 'x-api-key';
export const API_KEY_PREFIX = 'rsk_';

/** What a key may be granted; session-only matters (staff, roles, billing, keys themselves) are never on the list. */
export const API_KEY_GRANTABLE_PERMISSIONS = [
  'orders.view',
  'orders.manage',
  'menu.view',
  'menu.manage',
  'tables.manage',
  'customers.view',
  'customers.contact.view',
  'reports.view',
  'dispatch.view',
  'dispatch.manage',
  'courier.manage',
  'loyalty.view',
] as const satisfies readonly PermissionKey[];
export type ApiKeyPermission = (typeof API_KEY_GRANTABLE_PERMISSIONS)[number];

export const CreateApiKeySchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    permissions: z.array(z.enum(API_KEY_GRANTABLE_PERMISSIONS)).min(1).max(API_KEY_GRANTABLE_PERMISSIONS.length),
  })
  .strict();
export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;

export interface ApiKeyDTO {
  id: string;
  name: string;
  /** The public part of the token, enough to tell keys apart; never the secret. */
  keyId: string;
  permissions: ApiKeyPermission[];
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  createdBy: { fullName: string } | null;
}

/** The token is shown once, at creation; the platform keeps only a hash of the secret. */
export interface CreatedApiKeyDTO extends ApiKeyDTO {
  token: string;
}

const TOKEN = /^rsk_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;

export function formatApiKeyToken(keyId: string, secret: string): string {
  return `${API_KEY_PREFIX}${keyId}_${secret}`;
}

/** Splits a presented token into its lookup id and secret; null for anything that is not a key. */
export function parseApiKeyToken(token: string): { keyId: string; secret: string } | null {
  const match = TOKEN.exec(token.trim());
  return match ? { keyId: match[1], secret: match[2] } : null;
}
