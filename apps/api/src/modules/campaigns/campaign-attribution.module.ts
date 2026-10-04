import { Global, Module } from '@nestjs/common';
import { CampaignAttributionService } from './campaign-attribution.service';

/** Global so the order flow can credit campaigns without depending on the campaigns module. */
@Global()
@Module({ providers: [CampaignAttributionService], exports: [CampaignAttributionService] })
export class CampaignAttributionModule {}
