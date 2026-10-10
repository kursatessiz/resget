import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OtpPurpose } from '@resget/database';
import {
  PERMISSION_KEYS,
  SESSION_HANDOFF_TTL_SECONDS,
  effectivePermissions,
  moduleNeedsPlan,
  platformRoleOf,
} from '@resget/shared';
import type { AccessTokenClaims, MeDTO, SessionHandoffDTO, TokenPairDTO } from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { EntitlementsService, subscriptionForPlanSelect, subscriptionLike } from '../features/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { InviteAcceptanceService } from './invite-acceptance.service';
import { REFRESH_TOKEN_TTL_SECONDS, SessionsService } from './sessions.service';
import { unauthorized } from '../../common/api-error';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export { REFRESH_TOKEN_TTL_SECONDS };
/** Spent or expired handoff rows are kept this long, then removed when a new code is made. */
const HANDOFF_RETENTION_MS = 24 * 60 * 60 * 1000;

const handoffHash = (code: string): string => createHash('sha256').update(code).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
    private readonly invites: InviteAcceptanceService,
    private readonly features: FeatureFlagsService,
    private readonly plans: EntitlementsService,
    private readonly sessions: SessionsService,
  ) {}

  requestLoginCode(phone: string): Promise<{ expiresAt: Date }> {
    return this.otp.request(phone, OtpPurpose.LOGIN);
  }

  /**
   * A verified phone signs in; an unknown phone becomes a new user (a guest
   * registering from a table QR). Memberships decide what the user can open.
   */
  async verifyLoginCode(
    phone: string,
    code: string,
    fullName?: string,
    funnel: { qrToken?: string; qrSessionId?: string; inviteToken?: string } = {},
    userAgent?: string,
  ): Promise<TokenPairDTO> {
    const ok = await this.otp.verify(phone, OtpPurpose.LOGIN, code);
    if (!ok) throw unauthorized('Invalid or expired code');
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    const user = existing ?? (await this.prisma.user.create({ data: { phone, fullName: fullName?.trim() || phone } }));
    if (existing && fullName && existing.fullName === existing.phone) {
      await this.prisma.user.update({ where: { id: user.id }, data: { fullName: fullName.trim() } });
    }
    if (funnel.qrToken) await this.recordRegistration(user.id, funnel.qrToken, funnel.qrSessionId ?? null);
    // A staff invite is accepted in the same step; a mismatched phone fails the sign-in with the reason.
    if (funnel.inviteToken) await this.invites.accept(user.id, funnel.inviteToken);
    return this.issueTokens(user, await this.sessions.start(user.id, userAgent));
  }

  /** A guest who registers from a table becomes a customer of that restaurant and a REGISTERED funnel step. */
  private async recordRegistration(userId: string, qrToken: string, sessionId: string | null): Promise<void> {
    const table = await this.prisma.diningTable.findUnique({
      where: { qrToken },
      select: { id: true, restaurantId: true },
    });
    if (!table) return;
    await this.prisma.restaurantCustomer.upsert({
      where: { restaurantId_userId: { restaurantId: table.restaurantId, userId } },
      update: {},
      create: { restaurantId: table.restaurantId, userId, firstChannel: 'TABLE_QR' },
    });
    if (sessionId) {
      await this.prisma.qrScanEvent.create({
        data: { restaurantId: table.restaurantId, tableId: table.id, sessionId, outcome: 'REGISTERED', userId },
      });
    }
  }

  /**
   * Rotates the session (docs/GUVENLIK.md "Oturumlar"): a token two or more generations old, or one of an
   * ended session, is refused, and the former ends the session. A token issued before sessions existed
   * gets a new session here.
   */
  async refresh(refreshToken: string, userAgent?: string): Promise<TokenPairDTO> {
    const claims = await this.refreshClaims(refreshToken);
    const user = await this.prisma.user.findFirst({
      where: { id: claims.sub, deletedAt: null },
      select: { id: true, phone: true, isSuperAdmin: true },
    });
    if (!user) throw unauthorized('Unknown user');
    if (!claims.sid) return this.issueTokens(user, await this.sessions.start(user.id, userAgent));
    const rotated = await this.sessions.rotate(claims.sid, user.id, claims.gen ?? 0);
    if (!rotated.ok) throw unauthorized('Session ended');
    return this.issueTokens(user, { id: claims.sid, generation: rotated.generation });
  }

  /** Ends the session the access token belongs to; a token from before sessions existed has nothing to end. */
  async logout(userId: string, sessionId: string | undefined): Promise<void> {
    if (sessionId) await this.sessions.revokeOwn(userId, sessionId);
  }

  /** Sign-out with the refresh token, when the access token has already lapsed. */
  async logoutWithRefreshToken(refreshToken: string): Promise<void> {
    const claims = await this.refreshClaims(refreshToken);
    if (claims.sid) await this.sessions.revokeOwn(claims.sub, claims.sid);
  }

  private async refreshClaims(refreshToken: string): Promise<AccessTokenClaims> {
    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(refreshToken);
    } catch {
      throw unauthorized('Invalid refresh token');
    }
    if (claims.type !== 'refresh') throw unauthorized('Not a refresh token');
    return claims;
  }

  /**
   * A one-time code that carries this session into the browser
   * (docs/GUVENLIK.md): only its hash is stored and it lives a minute.
   */
  async createHandoff(userId: string, now: Date = new Date()): Promise<SessionHandoffDTO> {
    const code = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + SESSION_HANDOFF_TTL_SECONDS * 1000);
    await this.prisma.sessionHandoff.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - HANDOFF_RETENTION_MS) } },
    });
    await this.prisma.sessionHandoff.create({ data: { userId, codeHash: handoffHash(code), expiresAt } });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  /** Spends a handoff code once; an expired, used or unknown code, or a deleted account, is refused. */
  async redeemHandoff(code: string, now: Date = new Date(), userAgent?: string): Promise<TokenPairDTO> {
    const codeHash = handoffHash(code);
    const claimed = await this.prisma.sessionHandoff.updateMany({
      where: { codeHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw unauthorized('Invalid handoff code');
    const handoff = await this.prisma.sessionHandoff.findUniqueOrThrow({
      where: { codeHash },
      select: { user: { select: { id: true, phone: true, isSuperAdmin: true, deletedAt: true } } },
    });
    if (handoff.user.deletedAt) throw unauthorized('Unknown user');
    // The browser gets a session of its own: signing out the app does not sign out the browser, and back.
    return this.issueTokens(handoff.user, await this.sessions.start(handoff.user.id, userAgent, now));
  }

  async me(userId: string): Promise<MeDTO> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, phone: true, fullName: true, locale: true, isSuperAdmin: true },
    });
    // Catalogue order, not the database's: the same role always yields the same list.
    const ordered = (granted: ReadonlySet<string>) => PERMISSION_KEYS.filter((key) => granted.has(key));
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE', restaurant: { isActive: true, isPlatform: false } },
      select: {
        id: true,
        status: true,
        restaurant: {
          select: {
            id: true,
            name: true,
            slug: true,
            themePrimary: true,
            logoUrl: true,
            subscription: { select: subscriptionForPlanSelect },
          },
        },
        roleTemplate: { select: { name: true, isOwner: true, permissions: { select: { permissionKey: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const features = await Promise.all(memberships.map((m) => this.features.enabledFor(m.restaurant.id)));
    const plans = await Promise.all(
      memberships.map((m) => this.plans.resolveFor(m.restaurant.id, subscriptionLike(m.restaurant.subscription))),
    );
    // Platform marketing access (docs/PAZARLAMA.md) is reported apart from the restaurants.
    const platformMembership = await this.prisma.membership.findFirst({
      where: { userId, status: 'ACTIVE', restaurant: { isPlatform: true } },
      select: { roleTemplate: { select: { systemKey: true } } },
    });
    const platform = user.isSuperAdmin
      ? { role: null }
      : platformMembership && platformRoleOf(platformMembership.roleTemplate.systemKey)
        ? { role: platformRoleOf(platformMembership.roleTemplate.systemKey) }
        : null;
    return {
      user,
      platform,
      memberships: memberships.map((m, index) => ({
        membershipId: m.id,
        restaurantId: m.restaurant.id,
        restaurantName: m.restaurant.name,
        restaurantSlug: m.restaurant.slug,
        status: m.status,
        isOwner: m.roleTemplate.isOwner,
        roleName: m.roleTemplate.name,
        themePrimary: m.restaurant.themePrimary,
        logoUrl: m.restaurant.logoUrl,
        permissions: ordered(
          effectivePermissions(
            m.roleTemplate.isOwner,
            m.roleTemplate.permissions.map((p) => p.permissionKey),
          ),
        ),
        effectivePlan: plans[index].planCode,
        planName: plans[index].planName,
        entitlements: [...plans[index].entitlements],
        // A module the plan leaves out is hidden like a switched-off one; plan features keep their upsell screens.
        features: features[index].filter((key) => !moduleNeedsPlan(key) || plans[index].entitlements.has(key)),
      })),
    };
  }

  private async issueTokens(
    user: { id: string; phone: string; isSuperAdmin: boolean },
    session: { id: string; generation: number },
  ): Promise<TokenPairDTO> {
    const base = { sub: user.id, phone: user.phone, isSuperAdmin: user.isSuperAdmin, sid: session.id };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync({ ...base, type: 'access' } satisfies AccessTokenClaims, {
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      }),
      this.jwt.signAsync({ ...base, type: 'refresh', gen: session.generation } satisfies AccessTokenClaims, {
        expiresIn: REFRESH_TOKEN_TTL_SECONDS,
      }),
    ]);
    return { accessToken, refreshToken, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
  }
}
