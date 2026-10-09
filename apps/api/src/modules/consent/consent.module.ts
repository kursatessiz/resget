import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfigService } from '@nestjs/config';
import { CONSENT_REGISTRY, MockConsentRegistry, UnavailableConsentRegistry } from '../campaigns/consent-registry';
import { PublicRateLimitGuard } from '../storefront/public-rate-limit.guard';
import { AdminConsentController, ConsentConfirmController, ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';
import { ConsentSyncWatchdog } from './consent.watchdog';

/**
 * Commercial message consent (docs/RIZA.md). Global so orders, campaigns,
 * CRM, privacy and attribution share one history. The regional registry is
 * an adapter here: MOCK outside production; in production nothing is cleared
 * on covered channels until the IYS adapter is contracted and selected by
 * CONSENT_REGISTRY_PROVIDER.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [ConsentController, AdminConsentController, ConsentConfirmController],
  providers: [
    ConsentService,
    ConsentSyncWatchdog,
    PublicRateLimitGuard,
    {
      provide: CONSENT_REGISTRY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('NODE_ENV') === 'production' ? new UnavailableConsentRegistry() : new MockConsentRegistry(),
    },
  ],
  exports: [ConsentService, CONSENT_REGISTRY],
})
export class ConsentModule {}
