import { Global, Module } from '@nestjs/common';
import { CampaignAttributionService } from './campaign-attribution.service';
import { CommercialSenderService } from './commercial-sender.service';

/**
 * What campaigns and automated flows share: the commercial sender and the
 * conversion credit. Global so the order flow and the journeys module use
 * them without depending on the campaigns module.
 */
@Global()
@Module({
  providers: [CampaignAttributionService, CommercialSenderService],
  exports: [CampaignAttributionService, CommercialSenderService],
})
export class CampaignCoreModule {}
