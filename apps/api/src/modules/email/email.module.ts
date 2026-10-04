import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PublicRateLimitGuard } from '../storefront/public-rate-limit.guard';
import { EmailController, EmailWebhooksController } from './email.controller';
import { EmailService } from './email.service';
import { EMAIL_DNS, MockEmailDnsLookup, NodeEmailDnsLookup } from './email-dns';
import { EMAIL_PROVIDER, MockEmailProvider } from './email.provider';
import { SesEmailProvider } from './ses.provider';
import { SnsVerifier } from './sns-verifier';

/** Email channel (docs/EPOSTA.md): SES or the MOCK stand-in, DNS checks for sending domains, SNS feedback. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [EmailController, EmailWebhooksController],
  providers: [
    EmailService,
    PublicRateLimitGuard,
    { provide: SnsVerifier, useFactory: () => new SnsVerifier() },
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('EMAIL_PROVIDER') === 'SES'
          ? new SesEmailProvider({
              region: config.getOrThrow<string>('SES_REGION'),
              configurationSet: config.get<string>('SES_CONFIGURATION_SET') ?? null,
            })
          : new MockEmailProvider(config.get<string>('NODE_ENV') === 'production'),
    },
    {
      provide: EMAIL_DNS,
      inject: [ConfigService],
      // The same switch as custom domains: MOCK in tests, real DNS otherwise.
      useFactory: (config: ConfigService) =>
        (config.get<string>('DOMAIN_VERIFIER') ?? (config.get<string>('NODE_ENV') === 'test' ? 'MOCK' : 'DNS')) ===
        'MOCK'
          ? new MockEmailDnsLookup()
          : new NodeEmailDnsLookup(),
    },
  ],
  exports: [EmailService, EMAIL_PROVIDER],
})
export class EmailModule {}
