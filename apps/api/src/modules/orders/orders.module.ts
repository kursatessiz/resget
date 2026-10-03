import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersController } from './orders.controller';
import { PublicTrackingController } from './public-tracking.controller';
import { OrdersService } from './orders.service';
import { SettlementService } from './settlement.service';
import { OrderNotificationsService } from './order-notifications.service';

@Module({
  imports: [AuthModule],
  controllers: [OrdersController, PublicTrackingController],
  providers: [SettlementService, OrdersService, OrderNotificationsService],
  exports: [SettlementService, OrdersService, OrderNotificationsService],
})
export class OrdersModule {}
