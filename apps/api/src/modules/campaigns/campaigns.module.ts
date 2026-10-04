import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PublicRateLimitGuard } from '../storefront/public-rate-limit.guard';
import { CampaignsController, MarketingOptOutController } from './campaigns.controller';
import { CampaignsRunner } from './campaigns.runner';
import { CampaignsService } from './campaigns.service';

/** PRO campaigns (docs/KAMPANYALAR.md). Consent and the regional registry come from the global ConsentModule (docs/RIZA.md). */
@Module({
  imports: [AuthModule],
  controllers: [CampaignsController, MarketingOptOutController],
  providers: [CampaignsService, CampaignsRunner, PublicRateLimitGuard],
  exports: [CampaignsService, CampaignsRunner],
})
export class CampaignsModule {}
