import { z } from 'zod';
import type { InviteChannel, MembershipStatus } from './enums';
import { PermissionKeySchema } from './permissions';
import type { PermissionKey } from './permissions';
import { PhoneSchema, UuidSchema, stripTrailingSlashes } from './validators';

/**
 * Staff and roles (docs/PERSONEL.md). Users are global and identified by
 * phone; a restaurant invites a phone number to a role and the person joins
 * by signing in with that number through the invite link. Role templates
 * are tenant data: the owner template is fixed, every other role is a
 * subset of the permission catalogue the owner edits.
 */

export const INVITE_TTL_HOURS = 72;
/** URL-safe token in the invite link: 24 random bytes, base64url, 32 characters. */
export const INVITE_TOKEN_BYTES = 24;
export const InviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/, 'invalid invite token');

export function invitePath(token: string): string {
  return `/j/${token}`;
}

export function inviteUrl(publicAppUrl: string, token: string): string {
  return `${stripTrailingSlashes(publicAppUrl)}${invitePath(token)}`;
}

/** Channels a panel can send an invite through; WhatsApp falls back to SMS when the provider refuses it (docs/PERSONEL.md). */
export const INVITE_CHANNELS = ['SHOWN', 'SMS', 'WHATSAPP'] as const;
export type InviteChannelInput = (typeof INVITE_CHANNELS)[number];

const nonEmpty = (value: object) => Object.keys(value).length > 0;

export const CreateInviteSchema = z
  .object({
    phone: PhoneSchema,
    fullName: z.string().trim().min(2).max(120),
    roleTemplateId: UuidSchema,
    channel: z.enum(INVITE_CHANNELS).default('SHOWN'),
  })
  .strict();
export type CreateInviteInput = z.infer<typeof CreateInviteSchema>;

export const UpdateMembershipSchema = z
  .object({ roleTemplateId: UuidSchema.optional(), status: z.enum(['ACTIVE', 'PASSIVE']).optional() })
  .strict()
  .refine(nonEmpty, { message: 'empty update' });
export type UpdateMembershipInput = z.infer<typeof UpdateMembershipSchema>;

/**
 * Handing the business over (docs/PERSONEL.md, "Sahipliğin devri"): an
 * active member becomes the owner and the previous owner keeps working
 * under the role given here (never the owner role).
 */
export const TransferOwnershipSchema = z
  .object({ toMembershipId: UuidSchema, previousOwnerRoleId: UuidSchema })
  .strict();
export type TransferOwnershipInput = z.infer<typeof TransferOwnershipSchema>;

export const RoleNameSchema = z.string().trim().min(2).max(40);
export const CreateRoleSchema = z
  .object({ name: RoleNameSchema, permissions: z.array(PermissionKeySchema).max(100) })
  .strict();
export type CreateRoleInput = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = CreateRoleSchema.partial().refine(nonEmpty, { message: 'empty update' });
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;

export interface StaffMemberDTO {
  membershipId: string;
  userId: string;
  fullName: string;
  phone: string;
  status: `${MembershipStatus}`;
  isOwner: boolean;
  roleTemplateId: string;
  roleName: string;
  roleTemplateKey: string | null;
  joinedAt: string | null;
}

export interface RoleTemplateDTO {
  id: string;
  name: string;
  /** Key of a default template (`roles.default.<key>` is its label) or null for a custom role. */
  templateKey: string | null;
  isOwner: boolean;
  permissions: PermissionKey[];
  memberCount: number;
}

export interface InviteDTO {
  id: string;
  phone: string;
  fullName: string;
  roleTemplateId: string;
  roleName: string;
  roleTemplateKey: string | null;
  channel: `${InviteChannel}`;
  /** The link the person opens; carries the token. */
  url: string;
  expiresAt: string;
  createdAt: string;
  /** For sent invites: whether a provider accepted the message (WhatsApp or its SMS fallback). Null when nothing was sent. */
  smsAccepted: boolean | null;
  /** The channel the accepted message actually went through; null when nothing was sent or every attempt failed. */
  sentVia: 'SMS' | 'WHATSAPP' | null;
}

export interface StaffOverviewDTO {
  members: StaffMemberDTO[];
  invites: InviteDTO[];
  roles: RoleTemplateDTO[];
}

/** What the invite page shows before sign-in: no ids, the phone masked. */
export interface PublicInviteDTO {
  restaurantName: string;
  restaurantSlug: string;
  roleName: string;
  roleTemplateKey: string | null;
  fullName: string;
  phoneMasked: string;
  expiresAt: string;
  themePrimary: string;
  logoUrl: string | null;
}

export interface InviteAcceptedDTO {
  restaurantSlug: string;
  restaurantName: string;
}
