import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { OtpPurpose } from '@resget/database';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER } from '../messaging/sms.provider';
import type { SmsProvider } from '../messaging/sms.provider';
import { forbidden } from '../../common/api-error';

export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;
/** Codes requested per phone within the TTL window before the request is refused. */
export const OTP_MAX_PER_WINDOW = 3;

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private hash(phone: string, code: string): string {
    return createHash('sha256')
      .update(`${this.config.getOrThrow<string>('JWT_SECRET')}:${phone}:${code}`)
      .digest('hex');
  }

  async request(phone: string, purpose: OtpPurpose): Promise<{ expiresAt: Date }> {
    const since = new Date(Date.now() - OTP_TTL_MINUTES * 60_000);
    const recent = await this.prisma.otpCode.count({ where: { phone, purpose, createdAt: { gte: since } } });
    if (recent >= OTP_MAX_PER_WINDOW) throw forbidden('RATE_LIMITED', 'Too many codes requested');

    const code = this.config.get<string>('OTP_TEST_CODE') ?? randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
    await this.prisma.otpCode.create({ data: { phone, purpose, codeHash: this.hash(phone, code), expiresAt } });

    // The message text itself is a template of the messaging engine; this is the bootstrap wording.
    const result = await this.sms.send(phone, `Resget dogrulama kodunuz: ${code}`);
    if (!result.accepted) throw forbidden('RATE_LIMITED', 'SMS could not be sent');
    return { expiresAt };
  }

  /** Consumes the newest live code for the phone; counts failed attempts so a code cannot be brute forced. */
  async verify(phone: string, purpose: OtpPurpose, code: string): Promise<boolean> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) return false;
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw forbidden('RATE_LIMITED', 'Too many attempts');

    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hash(phone, code), 'hex');
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!matches) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      return false;
    }
    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
    return true;
  }
}
