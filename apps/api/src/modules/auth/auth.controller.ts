import { Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import {
  InviteTokenSchema,
  LogoutSchema,
  PhoneSchema,
  QrScanSessionSchema,
  RedeemSessionHandoffSchema,
  TableQrTokenSchema,
} from '@resget/shared';
import type { LogoutInput, MeDTO, RedeemSessionHandoffInput, SessionHandoffDTO, TokenPairDTO } from '@resget/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { forbidden, unauthorized } from '../../common/api-error';
import { RateLimiterService } from '../redis/rate-limiter.service';
import { PublicRateLimitGuard, RateLimit } from '../storefront/public-rate-limit.guard';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { CurrentUser, OptionalUser } from './decorators/current-user.decorator';
import type { AuthUser } from './tenant-context';

const RequestCodeSchema = z.object({ phone: PhoneSchema }).strict();
const VerifyCodeSchema = z
  .object({
    phone: PhoneSchema,
    code: z.string().regex(/^\d{6}$/),
    fullName: z.string().trim().min(2).max(120).optional(),
    /** Guest registering from a table QR: records the REGISTERED funnel step for that session. */
    qrToken: TableQrTokenSchema.optional(),
    qrSessionId: QrScanSessionSchema.optional(),
    /** Staff invite (docs/PERSONEL.md): the membership is created when the invited phone signs in. */
    inviteToken: InviteTokenSchema.optional(),
  })
  .strict();
const RefreshSchema = z.object({ refreshToken: z.string().min(20) }).strict();

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly limiter: RateLimiterService,
  ) {}

  /** Codes are limited per phone in OtpService; per client address here, so one host cannot spray many phones. */
  @Post('otp/request')
  @HttpCode(200)
  @UseGuards(PublicRateLimitGuard)
  @RateLimit({ bucket: 'otp', limit: 30, windowSeconds: 600 })
  async requestCode(
    @ZodBody(RequestCodeSchema) body: z.infer<typeof RequestCodeSchema>,
  ): Promise<{ expiresAt: string }> {
    const { expiresAt } = await this.auth.requestLoginCode(body.phone);
    return { expiresAt: expiresAt.toISOString() };
  }

  @Post('otp/verify')
  @HttpCode(200)
  @UseGuards(PublicRateLimitGuard)
  @RateLimit({ bucket: 'otp', limit: 30, windowSeconds: 600 })
  verifyCode(
    @ZodBody(VerifyCodeSchema) body: z.infer<typeof VerifyCodeSchema>,
    @Headers('user-agent') userAgent?: string,
  ): Promise<TokenPairDTO> {
    return this.auth.verifyLoginCode(
      body.phone,
      body.code,
      body.fullName,
      { qrToken: body.qrToken, qrSessionId: body.qrSessionId, inviteToken: body.inviteToken },
      userAgent,
    );
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(
    @ZodBody(RefreshSchema) body: z.infer<typeof RefreshSchema>,
    @Headers('user-agent') userAgent?: string,
  ): Promise<TokenPairDTO> {
    return this.auth.refresh(body.refreshToken, userAgent);
  }

  /**
   * Ends this session on the server (docs/GUVENLIK.md "Oturumlar"): with the bearer access token, or with
   * the refresh token in the body once the access token has lapsed. Clearing cookies alone is not a sign-out.
   */
  @Post('logout')
  @HttpCode(204)
  @UseGuards(PublicRateLimitGuard, OptionalJwtAuthGuard)
  @RateLimit({ bucket: 'logout', limit: 60, windowSeconds: 600 })
  async logout(
    @OptionalUser() user: AuthUser | null,
    @ZodBody(LogoutSchema.default({})) body: LogoutInput,
  ): Promise<void> {
    if (user?.sessionId) return this.auth.logout(user.id, user.sessionId);
    if (body.refreshToken) return this.auth.logoutWithRefreshToken(body.refreshToken);
    if (!user) throw unauthorized('No session');
  }

  /** The app opens the web with its session (docs/GUVENLIK.md); limited per user, an API key cannot ask. */
  @Post('handoff')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async handoff(@CurrentUser() user: AuthUser): Promise<SessionHandoffDTO> {
    if ((await this.limiter.hit(`rl:session-handoff:${user.id}`, 600)) > 30)
      throw forbidden('RATE_LIMITED', 'Too many requests');
    return this.auth.createHandoff(user.id);
  }

  /** Called by the web server's handoff route, which stores the tokens in httpOnly cookies. */
  @Post('handoff/redeem')
  @HttpCode(200)
  @UseGuards(PublicRateLimitGuard)
  @RateLimit({ bucket: 'session_handoff', limit: 60, windowSeconds: 600 })
  redeemHandoff(
    @ZodBody(RedeemSessionHandoffSchema) body: RedeemSessionHandoffInput,
    @Headers('user-agent') userAgent?: string,
  ): Promise<TokenPairDTO> {
    return this.auth.redeemHandoff(body.code, new Date(), userAgent);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser): Promise<MeDTO> {
    return this.auth.me(user.id);
  }
}
