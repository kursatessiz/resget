import { Global, Module } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { AdminFeaturesController } from './admin-features.controller';

/** Module switches; global so every guard and service reads the same copy. */
@Global()
@Module({ controllers: [AdminFeaturesController], providers: [FeatureFlagsService], exports: [FeatureFlagsService] })
export class FeaturesModule {}
