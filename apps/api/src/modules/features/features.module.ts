import { Global, Module } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { EntitlementsService } from './entitlements.service';
import { AdminFeaturesController } from './admin-features.controller';

/** Module switches and plan entitlements; global so every guard and service reads the same copy. */
@Global()
@Module({
  controllers: [AdminFeaturesController],
  providers: [FeatureFlagsService, EntitlementsService],
  exports: [FeatureFlagsService, EntitlementsService],
})
export class FeaturesModule {}
