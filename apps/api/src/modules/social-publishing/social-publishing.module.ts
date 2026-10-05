import { Module } from '@nestjs/common';
import { SocialImagesController, SocialPublishingController } from './social-publishing.controller';
import { SocialPublishingService } from './social-publishing.service';
import { SocialPublishingWatchdog } from './social-publishing.watchdog';

/** Social publishing (docs/SOSYAL_YAYIN.md); the connected accounts come from the global social module. */
@Module({
  controllers: [SocialPublishingController, SocialImagesController],
  providers: [SocialPublishingService, SocialPublishingWatchdog],
})
export class SocialPublishingModule {}
