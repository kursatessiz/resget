import { Module } from '@nestjs/common';
import { StorefrontModule } from '../storefront/storefront.module';
import { PublicRateLimitGuard } from '../storefront/public-rate-limit.guard';
import { PublicSiteController, SitePagesController } from './site.controller';
import { SiteService } from './site.service';

@Module({
  imports: [StorefrontModule],
  controllers: [SitePagesController, PublicSiteController],
  providers: [SiteService, PublicRateLimitGuard],
})
export class SiteModule {}
