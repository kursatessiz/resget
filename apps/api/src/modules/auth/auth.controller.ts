import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { InviteTokenSchema, PhoneSchema, QrScanSessionSchema, TableQrTokenSchema } from '@resget/shared';
import type { MeDTO, TokenPairDTO } from '@resget/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { PublicRateLimitGuard, RateLimit } from '../storefront/public-rate-limit.guard';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
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
  constructor(private readonly auth: AuthService) {}

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
  verifyCode(@ZodBody(VerifyCodeSchema) body: z.infer<typeof VerifyCodeSchema>): Promise<TokenPairDTO> {
    return this.auth.verifyLoginCode(body.phone, body.code, body.fullName, {
      qrToken: body.qrToken,
      qrSessionId: body.qrSessionId,
      inviteToken: body.inviteToken,
    });
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@ZodBody(RefreshSchema) body: z.infer<typeof RefreshSchema>): Promise<TokenPairDTO> {
    return this.auth.refresh(body.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser): Promise<MeDTO> {
    return this.auth.me(user.id);
  }
}
