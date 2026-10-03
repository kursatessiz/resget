import { Injectable } from '@nestjs/common';
import type { InviteAcceptedDTO } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { conflict, forbidden, notFound } from '../../common/api-error';

/**
 * Turns an invite into a membership. Lives in the auth module so the OTP
 * sign-in can accept an invite in the same step; the staff module's
 * authenticated accept endpoint uses the same method. The phone that signed
 * in must be the phone the invite was issued to.
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
    const role = await this.prisma.roleTemplate.findFirst({
      where: { id: invite.roleTemplateId, restaurantId: invite.restaurantId, isOwner: false },
      select: { id: true },
    });
    if (!role) throw notFound('INVITE_NOT_FOUND', 'Invite role no longer exists');

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.membership.upsert({
        where: { userId_restaurantId: { userId: user.id, restaurantId: invite.restaurantId } },
        update: { roleTemplateId: role.id, status: 'ACTIVE', joinedAt: now },
        create: {
          userId: user.id,
          restaurantId: invite.restaurantId,
          roleTemplateId: role.id,
          status: 'ACTIVE',
          joinedAt: now,
        },
      }),
      this.prisma.inviteToken.update({ where: { id: invite.id }, data: { usedAt: now } }),
      // A person who never set a name (new user from the OTP step) takes the name the inviter typed.
      ...(user.fullName === user.phone
        ? [this.prisma.user.update({ where: { id: user.id }, data: { fullName: invite.fullName } })]
        : []),
    ]);
    return { restaurantSlug: invite.restaurant.slug, restaurantName: invite.restaurant.name };
  }
}
