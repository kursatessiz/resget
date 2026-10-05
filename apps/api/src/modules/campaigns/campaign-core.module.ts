import { Global, Module } from '@nestjs/common';
import { CampaignAttributionService } from './campaign-attribution.service';
import { CampaignGuardsService } from './campaign-guards.service';
import { CommercialSenderService } from './commercial-sender.service';

/**
 * What campaigns and automated flows share: the commercial sender, the
 * conversion credit, and send approvals and limits (docs/ONAYLAR.md).
 * Global so the order flow, the journeys module and the console use them
 * without depending on the campaigns module.
 */
@Global()
@Module({
  providers: [CampaignAttributionService, CommercialSenderService, CampaignGuardsService],
  exports: [CampaignAttributionService, CommercialSenderService, CampaignGuardsService],
})
export class CampaignCoreModule {}
