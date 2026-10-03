import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { DomainsController, PublicDomainsController } from './domains.controller';
import { DomainsService } from './domains.service';
import { DOMAIN_VERIFIER, DnsDomainVerifier, MockDomainVerifier } from './domain-verifier';

@Module({
  imports: [AuthModule],
  controllers: [DomainsController, PublicDomainsController],
  providers: [
    DomainsService,
    {
      provide: DOMAIN_VERIFIER,
      inject: [ConfigService],
      // Tests resolve against the stand-in unless told otherwise; everything else asks real DNS.
      useFactory: (config: ConfigService) =>
        (config.get<string>('DOMAIN_VERIFIER') ?? (config.get<string>('NODE_ENV') === 'test' ? 'MOCK' : 'DNS')) ===
        'MOCK'
          ? new MockDomainVerifier(new URL(config.getOrThrow<string>('PUBLIC_APP_URL')).hostname.toLowerCase())
          : new DnsDomainVerifier(),
    },
  ],
  exports: [DomainsService],
})
export class DomainsModule {}
