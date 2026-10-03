import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { DispatchController } from './dispatch.controller';
import { CourierController } from './courier.controller';
import { DispatchService } from './dispatch.service';
import { LocationService } from './location.service';
import { RoutingRegistry } from './routing.registry';

@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [DispatchController, CourierController],
  providers: [RoutingRegistry, DispatchService, LocationService],
  exports: [DispatchService],
})
export class DispatchModule {}
