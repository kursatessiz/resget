import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WhatsAppTemplateMessage } from '@resget/shared';
import { maskPhone } from './sms.provider';
import type { SmsSendResult } from './sms.provider';

/**
 * WhatsApp Business API behind one interface; the messaging engine falls
 * back to SMS when it refuses. A template, when given, is what goes out
 * (business-initiated messages need one outside the 24-hour window); the
 * text is the plain-text form for providers or messages without one.
 */
export interface WhatsAppProvider {
  readonly code: string;
  send(toE164: string, text: string, template?: WhatsAppTemplateMessage): Promise<SmsSendResult>;
  balance?(): Promise<number | null>;
}

/** Development provider: accepts outside production and refuses in it, like the SMS mock. */
@Injectable()
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly code = 'MOCK';
  private readonly logger = new Logger(MockWhatsAppProvider.name);

  constructor(private readonly config: ConfigService) {}

  async send(toE164: string, text: string, template?: WhatsAppTemplateMessage): Promise<SmsSendResult> {
    const env = this.config.get<string>('NODE_ENV');
    if (env === 'production') {
      this.logger.error(`MOCK WhatsApp provider refused to send in production to ${maskPhone(toE164)}`);
      return { accepted: false, providerRef: null };
    }
    const shape = template ? `template ${template.name}/${template.language}` : 'text';
    this.logger.log(`MOCK WhatsApp ${shape} to ${maskPhone(toE164)}: ${env === 'development' ? text : '[hidden]'}`);
    return { accepted: true, providerRef: `mock-wa-${Date.now()}` };
  }
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
