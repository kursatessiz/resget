import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { PublicRateLimitGuard } from '../storefront/public-rate-limit.guard';
import { AttributionController, TrackingController } from './attribution.controller';
import { AttributionOrderHook } from './attribution.hooks';
import { AttributionService } from './attribution.service';

/** Global so sign-up, billing, storefront and CRM can call it without importing each other (docs/ATIF.md). */
@Global()
@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [AttributionController, TrackingController],
  providers: [AttributionService, AttributionOrderHook, PublicRateLimitGuard],
  exports: [AttributionService],
})
export class AttributionModule {}
