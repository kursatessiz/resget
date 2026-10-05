import { z } from 'zod';
import { OrderLineInputSchema } from './delivery';

/**
 * Group orders (docs/GRUP_SIPARISI.md, module group_orders): a shared basket
 * on the restaurant's own page. The host opens it and shares the link;
 * everyone joins with a name and keeps their own lines; the host places one
 * order for everyone and pays for all of it. Each browser holds its own key
 * (header x-group-key); the server keeps only its hash.
 */

export const GROUP_CART_TTL_HOURS = 6;
export const GROUP_CART_MAX_PARTICIPANTS = 20;
export const GROUP_CART_MAX_LINES = 30;
export const GROUP_CART_TOKEN_BYTES = 18;
export const GROUP_KEY_HEADER = 'x-group-key';

export const GroupCartTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{24}$/);
export const GroupParticipantNameSchema = z.string().trim().min(1).max(40);

export const CreateGroupCartSchema = z.object({ name: GroupParticipantNameSchema }).strict();
export type CreateGroupCartInput = z.infer<typeof CreateGroupCartSchema>;

export const JoinGroupCartSchema = z.object({ name: GroupParticipantNameSchema }).strict();
export type JoinGroupCartInput = z.infer<typeof JoinGroupCartSchema>;

export const GroupLinesSchema = z.object({ lines: z.array(OrderLineInputSchema).max(GROUP_CART_MAX_LINES) }).strict();
export type GroupLinesInput = z.infer<typeof GroupLinesSchema>;

export const GROUP_CART_STATUSES = ['OPEN', 'LOCKED', 'PLACED'] as const;
export type GroupCartStatusValue = (typeof GROUP_CART_STATUSES)[number];

/** Who joined: the key goes only to that browser. */
export interface GroupMembershipDTO {
  token: string;
  participantId: string;
  key: string;
}

export interface GroupCartLineDTO {
  menuItemId: string;
  name: string;
  quantity: number;
  modifiers: { id?: string; name: string; priceDeltaMinor: number }[];
  /** Item price plus options, from today's menu. */
  unitPriceMinor: number;
  /** False when the item or an option is no longer for sale; its owner removes it before the host pays. */
  available: boolean;
}

export interface GroupCartParticipantDTO {
  id: string;
  name: string;
  isHost: boolean;
  lines: GroupCartLineDTO[];
  subtotalMinor: number;
}

export interface GroupCartDTO {
  token: string;
  restaurantSlug: string;
  status: GroupCartStatusValue;
  currency: string;
  expiresAt: string;
  participants: GroupCartParticipantDTO[];
  totalMinor: number;
  /** The participant the request's key belongs to, if any. */
  youId: string | null;
  youAreHost: boolean;
}

/** The address of a basket's page. */
export function groupCartPath(slug: string, token: string): string {
  return `/${slug}/grup/${token}`;
}
