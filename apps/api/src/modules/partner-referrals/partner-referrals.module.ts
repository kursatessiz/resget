import { Global, Module } from '@nestjs/common';
import { PublicRateLimitGuard } from '../storefront/public-rate-limit.guard';
import {
  AdminPartnerReferralsController,
  PartnerInvitesController,
  PartnerReferralsController,
} from './partner-referrals.controller';
import { PartnerReferralsService } from './partner-referrals.service';
import { PartnerReferralsWatchdog } from './partner-referrals.watchdog';

/** Global so sign-up and order completion can both reach it. */
@Global()
@Module({
  controllers: [PartnerReferralsController, PartnerInvitesController, AdminPartnerReferralsController],
  providers: [PartnerReferralsService, PartnerReferralsWatchdog, PublicRateLimitGuard],
  exports: [PartnerReferralsService],
})
export class PartnerReferralsModule {}
