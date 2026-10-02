import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OtpPurpose } from '@resget/database';
import { effectivePermissions, effectivePlan } from '@resget/shared';
import type {
  AccessTokenClaims,
  MeDTO,
  SubscriptionStatus as SharedSubscriptionStatus,
  TokenPairDTO,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { unauthorized } from '../../common/api-error';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
  ) {}

  requestLoginCode(phone: string): Promise<{ expiresAt: Date }> {
    return this.otp.request(phone, OtpPurpose.LOGIN);
  }

  /**
   * A verified phone signs in; an unknown phone becomes a new user (a guest
   * registering from a table QR). Memberships decide what the user can open.
   */
  async verifyLoginCode(phone: string, code: string, fullName?: string): Promise<TokenPairDTO> {
    const ok = await this.otp.verify(phone, OtpPurpose.LOGIN, code);
    if (!ok) throw unauthorized('Invalid or expired code');
    const user =
      (await this.prisma.user.findUnique({ where: { phone } })) ??
      (await this.prisma.user.create({ data: { phone, fullName: fullName?.trim() || phone } }));
    return this.issueTokens(user.id, user.phone, user.isSuperAdmin);
  }

  async refresh(refreshToken: string): Promise<TokenPairDTO> {
    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(refreshToken);
    } catch {
      throw unauthorized('Invalid refresh token');
    }
    if (claims.type !== 'refresh') throw unauthorized('Not a refresh token');
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, phone: true, isSuperAdmin: true },
    });
    if (!user) throw unauthorized('Unknown user');
    return this.issueTokens(user.id, user.phone, user.isSuperAdmin);
  }

  async me(userId: string): Promise<MeDTO> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, phone: true, fullName: true, locale: true, isSuperAdmin: true },
    });
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE', restaurant: { isActive: true } },
      select: {
        id: true,
        status: true,
        restaurant: {
          select: {
            id: true,
            name: true,
            slug: true,
            subscription: {
              select: { plan: { select: { code: true } }, status: true, trialEndsAt: true, currentPeriodEnd: true },
            },
          },
        },
        roleTemplate: { select: { name: true, isOwner: true, permissions: { select: { permissionKey: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      user,
      memberships: memberships.map((m) => ({
        membershipId: m.id,
        restaurantId: m.restaurant.id,
        restaurantName: m.restaurant.name,
        restaurantSlug: m.restaurant.slug,
        status: m.status,
        isOwner: m.roleTemplate.isOwner,
        roleName: m.roleTemplate.name,
        permissions: [
          ...effectivePermissions(
            m.roleTemplate.isOwner,
            m.roleTemplate.permissions.map((p) => p.permissionKey),
          ),
        ],
        effectivePlan: effectivePlan(
          m.restaurant.subscription
            ? {
                planCode: m.restaurant.subscription.plan.code === 'PRO' ? 'PRO' : 'BASIC',
                status: m.restaurant.subscription.status as unknown as SharedSubscriptionStatus,
                trialEndsAt: m.restaurant.subscription.trialEndsAt,
                currentPeriodEnd: m.restaurant.subscription.currentPeriodEnd,
              }
            : null,
        ),
      })),
    };
  }

  private async issueTokens(userId: string, phone: string, isSuperAdmin: boolean): Promise<TokenPairDTO> {
    const base = { sub: userId, phone, isSuperAdmin };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync({ ...base, type: 'access' } satisfies AccessTokenClaims, {
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      }),
      this.jwt.signAsync({ ...base, type: 'refresh' } satisfies AccessTokenClaims, {
        expiresIn: REFRESH_TOKEN_TTL_SECONDS,
      }),
    ]);
    return { accessToken, refreshToken, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
  }
}
