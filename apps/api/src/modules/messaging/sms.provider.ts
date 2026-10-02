import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SmsSendResult {
  accepted: boolean;
  providerRef: string | null;
}

export interface SmsProvider {
  readonly code: string;
  send(toE164: string, text: string): Promise<SmsSendResult>;
}

/** Masks a phone for logs: +9053*****33. */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return '***';
  return `${phone.slice(0, 5)}${'*'.repeat(Math.max(0, phone.length - 7))}${phone.slice(-2)}`;
}

/**
 * Development provider: logs the message (never the OTP itself outside
 * development) and reports success. Real adapters (Netgsm, Ileti Merkezi,
 * Twilio) are registered by SMS_PROVIDER; until one is wired the platform
 * must not pretend a production message was delivered.
 */
@Injectable()
export class MockSmsProvider implements SmsProvider {
  readonly code = 'MOCK';
  private readonly logger = new Logger(MockSmsProvider.name);

  constructor(private readonly config: ConfigService) {}

  async send(toE164: string, text: string): Promise<SmsSendResult> {
    const env = this.config.get<string>('NODE_ENV');
    if (env === 'production') {
      this.logger.error(`MOCK SMS provider refused to send in production to ${maskPhone(toE164)}`);
      return { accepted: false, providerRef: null };
    }
    const body = env === 'development' ? text : '[hidden]';
    this.logger.log(`MOCK SMS to ${maskPhone(toE164)}: ${body}`);
    return { accepted: true, providerRef: `mock-${Date.now()}` };
  }
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
