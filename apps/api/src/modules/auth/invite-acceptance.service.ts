import { Injectable } from '@nestjs/common';
import { effectivePermissions } from '@resget/shared';
import type { InviteAcceptedDTO } from '@resget/shared';
import type { Prisma } from '@resget/database';
import { PrismaService } from '../prisma/prisma.service';
import { conflict, forbidden, notFound } from '../../common/api-error';

const rolePermissions = { select: { isOwner: true, permissions: { select: { permissionKey: true } } } } as const;

/**
 * Turns an invite into a membership. Lives in the auth module so the OTP
 * sign-in can accept an invite in the same step; the staff module's
 * authenticated accept endpoint uses the same method. The phone that signed
 * in must be the phone the invite was issued to.
 *
 * Redemption honours the same authority rules as a direct membership change
 * (docs/PERSONEL.md, "Roller"): the issuer must still be able to grant the
 * role, the owner membership is never overwritten, a member whose present role
 * exceeds the issuer's authority is not reopened or re-roled, and a link is
 * claimed exactly once.
 */
@Injectable()
export class InviteAcceptanceService {
  constructor(private readonly prisma: PrismaService) {}

  async accept(userId: string, token: string): Promise<InviteAcceptedDTO> {
    const invite = await this.prisma.inviteToken.findUnique({
      where: { token },
      include: { restaurant: { select: { id: true, slug: true, name: true, isActive: true } } },
    });
    if (!invite || !invite.restaurant.isActive) throw notFound('INVITE_NOT_FOUND', 'Invite not found');
    if (invite.usedAt) throw conflict('INVITE_USED', 'Invite already used');
    if (invite.expiresAt.getTime() < Date.now()) throw conflict('INVITE_EXPIRED', 'Invite expired');
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, phone: true, fullName: true },
    });
    if (user.phone !== invite.phone) throw forbidden('INVITE_PHONE_MISMATCH', 'Invite is for another phone');

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // The conditional claim takes the row lock: of parallel redemptions exactly one proceeds, and an invite the
      // issuer's deactivation expired in the meantime is not claimed.
      const claimed = await tx.inviteToken.updateMany({
        where: { id: invite.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count === 0) {
        const current = await tx.inviteToken.findUniqueOrThrow({ where: { id: invite.id }, select: { usedAt: true } });
        throw current.usedAt
          ? conflict('INVITE_USED', 'Invite already used')
          : conflict('INVITE_EXPIRED', 'Invite expired');
      }
      const role = await tx.roleTemplate.findFirst({
        where: { id: invite.roleTemplateId, restaurantId: invite.restaurantId, isOwner: false },
        select: { id: true, permissions: { select: { permissionKey: true } } },
      });
      if (!role) throw notFound('INVITE_NOT_FOUND', 'Invite role no longer exists');

      const existing = await tx.membership.findUnique({
        where: { userId_restaurantId: { userId: user.id, restaurantId: invite.restaurantId } },
        select: { roleTemplate: rolePermissions },
      });
      if (existing?.roleTemplate.isOwner) {
        throw conflict('STAFF_OWNER_PROTECTED', 'The owner membership cannot be changed by an invite');
      }
      const issuer = await this.issuerAuthority(tx, invite.createdByUserId, invite.restaurantId);
      if (!issuer) throw forbidden('INVITE_REVOKED', 'The issuer can no longer grant this invite');
      if (issuer !== 'UNRESTRICTED') {
        const required = ['staff.manage', ...role.permissions.map((p) => p.permissionKey)];
        if (!required.every((key) => issuer.has(key))) {
          throw forbidden('INVITE_REVOKED', 'The issuer can no longer grant this invite');
        }
        // As in StaffService.updateMember: a member whose present role carries more than the issuer holds is not
        // reopened or re-roled by the issuer, through the invite path either.
        const current = existing?.roleTemplate.permissions.map((p) => p.permissionKey) ?? [];
        if (!current.every((key) => issuer.has(key))) {
          throw forbidden('ROLE_ESCALATION', 'The member holds more than the issuer can grant');
        }
      }

      await tx.membership.upsert({
        where: { userId_restaurantId: { userId: user.id, restaurantId: invite.restaurantId } },
        update: { roleTemplateId: role.id, status: 'ACTIVE', joinedAt: now },
        create: {
          userId: user.id,
          restaurantId: invite.restaurantId,
          roleTemplateId: role.id,
          status: 'ACTIVE',
          joinedAt: now,
        },
      });
      // A person who never set a name (new user from the OTP step) takes the name the inviter typed.
      if (user.fullName === user.phone) {
        await tx.user.update({ where: { id: user.id }, data: { fullName: invite.fullName } });
      }
    });
    return { restaurantSlug: invite.restaurant.slug, restaurantName: invite.restaurant.name };
  }

  /**
   * What the issuer may grant today: everything for the platform administrator and the owner, their current
   * permissions for any other active member, nothing (null) once they left, were closed or deleted their account.
   */
  private async issuerAuthority(
    tx: Prisma.TransactionClient,
    issuerUserId: string,
    restaurantId: string,
  ): Promise<'UNRESTRICTED' | Set<string> | null> {
    const issuer = await tx.user.findUnique({
      where: { id: issuerUserId },
      select: {
        isSuperAdmin: true,
        deletedAt: true,
        memberships: { where: { restaurantId }, select: { status: true, roleTemplate: rolePermissions } },
      },
    });
    if (!issuer || issuer.deletedAt) return null;
    if (issuer.isSuperAdmin) return 'UNRESTRICTED';
    const membership = issuer.memberships[0];
    if (!membership || membership.status !== 'ACTIVE') return null;
    if (membership.roleTemplate.isOwner) return 'UNRESTRICTED';
    return effectivePermissions(
      false,
      membership.roleTemplate.permissions.map((p) => p.permissionKey),
    );
  }
}
