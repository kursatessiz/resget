import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { PublicRateLimitGuard } from '../storefront/public-rate-limit.guard';
import { LeadAdsController, MetaWebhookController } from './lead-ads.controller';
import { LeadAdsService } from './lead-ads.service';
import { LeadAdsWatchdog } from './lead-ads.watchdog';

/** Lead Ads to CRM (docs/LEAD_ADS.md); the connected pages come from the global social module. */
@Module({
  imports: [CrmModule],
  controllers: [LeadAdsController, MetaWebhookController],
  providers: [LeadAdsService, LeadAdsWatchdog, PublicRateLimitGuard],
})
export class LeadAdsModule {}
