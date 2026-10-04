import { Logger } from '@nestjs/common';
import {
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  SESv2Client,
  SendEmailCommand,
} from '@aws-sdk/client-sesv2';
import { encodeDisplayName } from './email.provider';
import type { EmailProvider, EmailSendResult, OutgoingEmail } from './email.provider';

export interface SesConfig {
  region: string;
  configurationSet: string | null;
}

/**
 * Amazon SES (API v2). Credentials come from the SDK's default chain
 * (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or an instance role), never
 * from code. Bounces and complaints come back through SNS (EmailWebhooksController).
 */
export class SesEmailProvider implements EmailProvider {
  readonly code = 'SES' as const;
  private readonly logger = new Logger(SesEmailProvider.name);
  private readonly client: SESv2Client;

  constructor(private readonly config: SesConfig) {
    this.client = new SESv2Client({ region: config.region });
  }

  ready(): boolean {
    return true;
  }

  async send(email: OutgoingEmail): Promise<EmailSendResult> {
    try {
      const result = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: `${encodeDisplayName(email.fromName)} <${email.from}>`,
          Destination: { ToAddresses: [email.to] },
          ReplyToAddresses: email.replyTo ? [email.replyTo] : undefined,
          ConfigurationSetName: this.config.configurationSet ?? undefined,
          Content: {
            Simple: {
              Subject: { Data: email.subject, Charset: 'UTF-8' },
              Body: { Html: { Data: email.html, Charset: 'UTF-8' }, Text: { Data: email.text, Charset: 'UTF-8' } },
              Headers: Object.entries(email.headers).map(([Name, Value]) => ({ Name, Value })),
            },
          },
        }),
      );
      return { status: 'SENT', providerRef: result.MessageId ?? null, errorCode: null };
    } catch (error) {
      const name = error instanceof Error ? error.name : 'SES_ERROR';
      this.logger.warn(`SES send failed: ${name}`);
      return { status: 'FAILED', providerRef: null, errorCode: name.slice(0, 60) };
    }
  }

  async createIdentity(domain: string): Promise<{ dkimTokens: string[] }> {
    const result = await this.client.send(new CreateEmailIdentityCommand({ EmailIdentity: domain }));
    return { dkimTokens: result.DkimAttributes?.Tokens ?? [] };
  }

  async deleteIdentity(domain: string): Promise<void> {
    await this.client.send(new DeleteEmailIdentityCommand({ EmailIdentity: domain })).catch(() => undefined);
  }
}
