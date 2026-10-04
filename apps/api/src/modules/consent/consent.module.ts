import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CONSENT_REGISTRY, MockConsentRegistry } from '../campaigns/consent-registry';
import { PublicRateLimitGuard } from '../storefront/public-rate-limit.guard';
import { AdminConsentController, ConsentConfirmController, ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';
import { ConsentSyncWatchdog } from './consent.watchdog';

/**
 * Commercial message consent (docs/RIZA.md). Global so orders, campaigns,
 * CRM, privacy and attribution share one history. The regional registry is
 * an adapter here; MOCK until IYS is contracted.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [ConsentController, AdminConsentController, ConsentConfirmController],
  providers: [
    ConsentService,
    ConsentSyncWatchdog,
    PublicRateLimitGuard,
    { provide: CONSENT_REGISTRY, useFactory: () => new MockConsentRegistry() },
  ],
  exports: [ConsentService, CONSENT_REGISTRY],
})
export class ConsentModule {}
