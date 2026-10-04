import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@resget/database';
import {
  BASE_LOCALE,
  BUNDLED_MESSAGES,
  INVITE_TOKEN_BYTES,
  INVITE_TTL_HOURS,
  createTranslator,
  inviteUrl,
  isPermissionKey,
} from '@resget/shared';
import type {
  CreateInviteInput,
  CreateRoleInput,
  InviteDTO,
  PublicInviteDTO,
  RoleTemplateDTO,
  StaffMemberDTO,
  StaffOverviewDTO,
  UpdateMembershipInput,
  UpdateRoleInput,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { maskPhone } from '../messaging/sms.provider';
import { MessagingService } from '../messaging/messaging.service';
import type { TenantContext } from '../auth/tenant-context';
import { renderQrPng } from '../tables/qr-label';
import { badRequest, conflict, notFound } from '../../common/api-error';

const roleSelect = Prisma.validator<Prisma.RoleTemplateSelect>()({
  id: true,
  name: true,
  templateKey: true,
  isOwner: true,
  permissions: { select: { permissionKey: true } },
  _count: { select: { memberships: true } },
});

const memberSelect = Prisma.validator<Prisma.MembershipSelect>()({
  id: true,
  status: true,
  joinedAt: true,
  user: { select: { id: true, fullName: true, phone: true } },
  roleTemplate: { select: { id: true, name: true, templateKey: true, isOwner: true } },
});

const inviteSelect = Prisma.validator<Prisma.InviteTokenSelect>()({
  id: true,
  phone: true,
  fullName: true,
  roleTemplateId: true,
  token: true,
  channel: true,
  expiresAt: true,
  createdAt: true,
});

type RoleRow = Prisma.RoleTemplateGetPayload<{ select: typeof roleSelect }>;
type MemberRow = Prisma.MembershipGetPayload<{ select: typeof memberSelect }>;
type InviteRow = Prisma.InviteTokenGetPayload<{ select: typeof inviteSelect }>;

/** Staff, invites and roles of a restaurant (docs/PERSONEL.md). */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly messaging: MessagingService,
  ) {}

  async overview(restaurantId: string): Promise<StaffOverviewDTO> {
    const [members, invites, roles] = await Promise.all([
      this.prisma.membership.findMany({
        where: { restaurantId },
        orderBy: [{ roleTemplate: { isOwner: 'desc' } }, { createdAt: 'asc' }],
        select: memberSelect,
      }),
      this.prisma.inviteToken.findMany({
        where: { restaurantId, usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: inviteSelect,
      }),
      this.listRoles(restaurantId),
    ]);
    const roleById = new Map(roles.map((r) => [r.id, r]));
    return {
      members: members.map((m) => this.toMember(m)),
      invites: invites.map((i) => this.toInvite(i, roleById.get(i.roleTemplateId) ?? null, null)),
      roles,
    };
  }

  // -- Roles (roles.manage) ------------------------------------------------------------

  async listRoles(restaurantId: string): Promise<RoleTemplateDTO[]> {
    const roles = await this.prisma.roleTemplate.findMany({
      where: { restaurantId },
      orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }],
      select: roleSelect,
    });
    return roles.map((r) => this.toRole(r));
  }

  async createRole(restaurantId: string, input: CreateRoleInput): Promise<RoleTemplateDTO> {
    try {
      const role = await this.prisma.roleTemplate.create({
        data: {
          restaurantId,
          name: input.name,
          isOwner: false,
          permissions: { create: unique(input.permissions).map((permissionKey) => ({ permissionKey })) },
        },
        select: roleSelect,
      });
      return this.toRole(role);
    } catch (error) {
      throw this.roleNameConflict(error);
    }
  }

  /** Default templates keep their key but their name and permissions are the owner's to change; the owner role is fixed. */
  async updateRole(restaurantId: string, roleId: string, input: UpdateRoleInput): Promise<RoleTemplateDTO> {
    const role = await this.requireRole(restaurantId, roleId);
    if (role.isOwner) throw conflict('ROLE_PROTECTED', 'The owner role cannot be changed');
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (input.permissions) {
          await tx.roleTemplatePermission.deleteMany({ where: { roleTemplateId: roleId } });
          await tx.roleTemplatePermission.createMany({
            data: unique(input.permissions).map((permissionKey) => ({ roleTemplateId: roleId, permissionKey })),
          });
        }
        return tx.roleTemplate.update({
          where: { id: roleId },
          data: input.name ? { name: input.name } : {},
          select: roleSelect,
        });
      });
      return this.toRole(updated);
    } catch (error) {
      throw this.roleNameConflict(error);
    }
  }

  async deleteRole(restaurantId: string, roleId: string): Promise<void> {
    const role = await this.requireRole(restaurantId, roleId);
    if (role.isOwner) throw conflict('ROLE_PROTECTED', 'The owner role cannot be deleted');
    const [members, invites] = await Promise.all([
      this.prisma.membership.count({ where: { roleTemplateId: roleId } }),
      this.prisma.inviteToken.count({ where: { roleTemplateId: roleId, usedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    if (members > 0 || invites > 0) throw conflict('ROLE_IN_USE', 'Role is assigned');
    await this.prisma.roleTemplate.delete({ where: { id: roleId } });
  }

  // -- Members (staff.manage) ----------------------------------------------------------

  async updateMember(
    tenant: TenantContext,
    membershipId: string,
    input: UpdateMembershipInput,
  ): Promise<StaffMemberDTO> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, restaurantId: tenant.restaurantId },
      select: memberSelect,
    });
    if (!membership) throw notFound('NOT_FOUND', 'Membership not found');
    if (membership.roleTemplate.isOwner && !tenant.isSuperAdmin) {
      throw conflict('STAFF_OWNER_PROTECTED', 'The owner membership cannot be changed');
    }
    if (input.roleTemplateId) {
      const role = await this.requireRole(tenant.restaurantId, input.roleTemplateId);
      if (role.isOwner) throw conflict('ROLE_PROTECTED', 'The owner role cannot be assigned');
    }
    const updated = await this.prisma.membership.update({
      where: { id: membershipId },
      data: input,
      select: memberSelect,
    });
    return this.toMember(updated);
  }

  // -- Invites (staff.manage) ----------------------------------------------------------

  async createInvite(tenant: TenantContext, createdByUserId: string, input: CreateInviteInput): Promise<InviteDTO> {
    const role = await this.requireRole(tenant.restaurantId, input.roleTemplateId);
    if (role.isOwner) throw badRequest('ROLE_PROTECTED', 'The owner role cannot be invited');
    const existing = await this.prisma.membership.findFirst({
      where: { restaurantId: tenant.restaurantId, status: 'ACTIVE', user: { phone: input.phone } },
      select: { id: true },
    });
    if (existing) throw conflict('STAFF_ALREADY_MEMBER', 'Phone already belongs to an active member');

    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: tenant.restaurantId },
      select: { name: true, defaultLocale: true },
    });
    // A fresh invite supersedes the pending ones for the same phone, so one link is valid at a time.
    await this.prisma.inviteToken.updateMany({
      where: { restaurantId: tenant.restaurantId, phone: input.phone, usedAt: null, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });
    const invite = await this.prisma.inviteToken.create({
      data: {
        restaurantId: tenant.restaurantId,
        createdByUserId,
        phone: input.phone,
        fullName: input.fullName,
        roleTemplateId: role.id,
        token: randomBytes(INVITE_TOKEN_BYTES).toString('base64url'),
        channel: input.channel,
        expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600_000),
      },
      select: inviteSelect,
    });

    let smsAccepted: boolean | null = null;
    let sentVia: 'SMS' | 'WHATSAPP' | null = null;
    if (input.channel === 'SMS' || input.channel === 'WHATSAPP') {
      const t = this.translator(restaurant.defaultLocale);
      // Platform traffic like the OTP: logged by the engine, the restaurant's wallet is not charged.
      const result = await this.messaging.send({
        restaurantId: tenant.restaurantId,
        channel: input.channel,
        to: input.phone,
        templateKey: 'staff.invite',
        params: {
          restaurant: restaurant.name,
          role: role.templateKey ? t(`roles.default.${role.templateKey}`) : role.name,
          hours: INVITE_TTL_HOURS,
          url: this.url(invite.token),
        },
        locale: restaurant.defaultLocale,
        billable: false,
        // A WhatsApp invite the provider refuses (no account, outside the window) still reaches the phone as SMS.
        fallbackToSms: true,
      });
      smsAccepted = result.status === 'SENT';
      sentVia = result.status === 'SENT' ? result.channel : null;
    }
    return this.toInvite(invite, role, smsAccepted, sentVia);
  }

  async revokeInvite(restaurantId: string, inviteId: string): Promise<void> {
    const invite = await this.prisma.inviteToken.findFirst({
      where: { id: inviteId, restaurantId },
      select: { id: true },
    });
    if (!invite) throw notFound('INVITE_NOT_FOUND', 'Invite not found');
    await this.prisma.inviteToken.update({ where: { id: inviteId }, data: { expiresAt: new Date() } });
  }

  async inviteQrPng(restaurantId: string, inviteId: string): Promise<Buffer> {
    const invite = await this.prisma.inviteToken.findFirst({
      where: { id: inviteId, restaurantId, usedAt: null, expiresAt: { gt: new Date() } },
      select: { token: true },
    });
    if (!invite) throw notFound('INVITE_NOT_FOUND', 'Invite not found');
    return renderQrPng(this.url(invite.token));
  }

  /** The invite page before sign-in: enough to recognise the restaurant and the role, nothing more. */
  async publicInvite(token: string): Promise<PublicInviteDTO> {
    const invite = await this.prisma.inviteToken.findUnique({
      where: { token },
      select: {
        fullName: true,
        phone: true,
        expiresAt: true,
        usedAt: true,
        roleTemplateId: true,
        restaurant: { select: { name: true, slug: true, themePrimary: true, logoUrl: true, isActive: true } },
      },
    });
    if (!invite || !invite.restaurant.isActive) throw notFound('INVITE_NOT_FOUND', 'Invite not found');
    if (invite.usedAt) throw conflict('INVITE_USED', 'Invite already used');
    if (invite.expiresAt.getTime() < Date.now()) throw conflict('INVITE_EXPIRED', 'Invite expired');
    const role = await this.prisma.roleTemplate.findUnique({
      where: { id: invite.roleTemplateId },
      select: { name: true, templateKey: true },
    });
    return {
      restaurantName: invite.restaurant.name,
      restaurantSlug: invite.restaurant.slug,
      roleName: role?.name ?? '',
      roleTemplateKey: role?.templateKey ?? null,
      fullName: invite.fullName,
      phoneMasked: maskPhone(invite.phone),
      expiresAt: invite.expiresAt.toISOString(),
      themePrimary: invite.restaurant.themePrimary,
      logoUrl: invite.restaurant.logoUrl,
    };
  }

  // -- Helpers -------------------------------------------------------------------------

  private url(token: string): string {
    return inviteUrl(this.config.getOrThrow<string>('PUBLIC_APP_URL'), token);
  }

  private translator(locale: string) {
    const messages = BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE];
    return createTranslator({ locale, messages, fallback: BUNDLED_MESSAGES[BASE_LOCALE] });
  }

  private async requireRole(restaurantId: string, roleId: string): Promise<RoleTemplateDTO> {
    const role = await this.prisma.roleTemplate.findFirst({ where: { id: roleId, restaurantId }, select: roleSelect });
    if (!role) throw notFound('NOT_FOUND', 'Role not found');
    return this.toRole(role);
  }

  private roleNameConflict(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return conflict('ROLE_NAME_TAKEN', 'Role name already exists');
    }
    return error;
  }

  private toRole(row: RoleRow): RoleTemplateDTO {
    return {
      id: row.id,
      name: row.name,
      templateKey: row.templateKey,
      isOwner: row.isOwner,
      permissions: row.permissions.map((p) => p.permissionKey).filter(isPermissionKey),
      memberCount: row._count.memberships,
    };
  }

  private toMember(row: MemberRow): StaffMemberDTO {
    return {
      membershipId: row.id,
      userId: row.user.id,
      fullName: row.user.fullName,
      phone: row.user.phone,
      status: row.status,
      isOwner: row.roleTemplate.isOwner,
      roleTemplateId: row.roleTemplate.id,
      roleName: row.roleTemplate.name,
      roleTemplateKey: row.roleTemplate.templateKey,
      joinedAt: row.joinedAt ? row.joinedAt.toISOString() : null,
    };
  }

  private toInvite(
    row: InviteRow,
    role: RoleTemplateDTO | null,
    smsAccepted: boolean | null,
    sentVia: 'SMS' | 'WHATSAPP' | null = null,
  ): InviteDTO {
    return {
      id: row.id,
      phone: row.phone,
      fullName: row.fullName,
      roleTemplateId: row.roleTemplateId,
      roleName: role?.name ?? '',
      roleTemplateKey: role?.templateKey ?? null,
      channel: row.channel,
      url: this.url(row.token),
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      smsAccepted,
      sentVia,
    };
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
