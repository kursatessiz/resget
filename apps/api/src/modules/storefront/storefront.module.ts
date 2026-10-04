import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { CourierModule } from '../courier/courier.module';
import { MenuModule } from '../menu/menu.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { PublicRateLimitGuard } from './public-rate-limit.guard';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';

@Module({
  imports: [MenuModule, OrdersModule, PaymentsModule, CourierModule, AvailabilityModule],
  controllers: [StorefrontController],
  providers: [StorefrontService, PublicRateLimitGuard],
})
export class StorefrontModule {}
