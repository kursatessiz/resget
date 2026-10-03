import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PublicRateLimitGuard } from '../storefront/public-rate-limit.guard';
import { CampaignsController, MarketingOptOutController } from './campaigns.controller';
import { CampaignsRunner } from './campaigns.runner';
import { CampaignsService } from './campaigns.service';
import { CONSENT_REGISTRY, MockConsentRegistry } from './consent-registry';

/** PRO campaigns (docs/KAMPANYALAR.md). The regional consent registry is an adapter; MOCK until IYS is contracted. */
@Module({
  imports: [AuthModule],
  controllers: [CampaignsController, MarketingOptOutController],
  providers: [
    CampaignsService,
    CampaignsRunner,
    PublicRateLimitGuard,
    { provide: CONSENT_REGISTRY, useFactory: () => new MockConsentRegistry() },
  ],
  exports: [CampaignsService, CampaignsRunner],
})
export class CampaignsModule {}
