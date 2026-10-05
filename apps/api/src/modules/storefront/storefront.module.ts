import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { CourierModule } from '../courier/courier.module';
import { MenuModule } from '../menu/menu.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import { GroupOrdersController } from './group-orders.controller';
import { GroupOrdersService } from './group-orders.service';
import { PublicRateLimitGuard } from './public-rate-limit.guard';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';

@Module({
  imports: [MenuModule, OrdersModule, PaymentsModule, CourierModule, AvailabilityModule, RestaurantsModule],
  controllers: [StorefrontController, GroupOrdersController],
  providers: [StorefrontService, GroupOrdersService, PublicRateLimitGuard],
  exports: [StorefrontService],
})
export class StorefrontModule {}
