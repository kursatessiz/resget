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

/** Lifetimes a key may be given at creation; without one the key works until it is revoked. */
export const API_KEY_EXPIRY_DAYS = [30, 90, 180, 365] as const;
export type ApiKeyExpiryDays = (typeof API_KEY_EXPIRY_DAYS)[number];

/** How many days of request counts the list and the usage report cover (UTC days, today included). */
export const API_KEY_USAGE_DAYS = 30;

export const CreateApiKeySchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    permissions: z.array(z.enum(API_KEY_GRANTABLE_PERMISSIONS)).min(1).max(API_KEY_GRANTABLE_PERMISSIONS.length),
    expiresInDays: z
      .number()
      .int()
      .refine((days): days is ApiKeyExpiryDays => (API_KEY_EXPIRY_DAYS as readonly number[]).includes(days))
      .nullable()
      .optional(),
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
  /** After this moment the key gets 401 API_KEY_EXPIRED; null means it never expires. */
  expiresAt: string | null;
  /** Requests made with the key over the last API_KEY_USAGE_DAYS days. */
  requestsLastDays: number;
  createdBy: { fullName: string } | null;
}

export type ApiKeyStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

/** Revoked wins over expired: a revoked key stays revoked whatever its date. */
export function apiKeyStatus(
  key: { revokedAt: string | Date | null; expiresAt: string | Date | null },
  now: Date,
): ApiKeyStatus {
  if (key.revokedAt) return 'REVOKED';
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

/** A key's daily request counts, oldest first, one entry per UTC day (days without requests count zero). */
export interface ApiKeyUsageDTO {
  id: string;
  days: { day: string; requests: number }[];
  total: number;
}

/** The UTC calendar days of the usage window ending today, oldest first, as YYYY-MM-DD. */
export function apiKeyUsageWindow(now: Date, days: number = API_KEY_USAGE_DAYS): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, i) =>
    new Date(today - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
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
