import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersController } from './orders.controller';
import { PublicTrackingController } from './public-tracking.controller';
import { OrdersService } from './orders.service';
import { SettlementService } from './settlement.service';
import { OrderNotificationsService } from './order-notifications.service';
import { OrdersWatchdog } from './orders.watchdog';
import { LoyaltyEarnedNotifier } from './loyalty-earned.notifier';

@Module({
  imports: [AuthModule],
  controllers: [OrdersController, PublicTrackingController],
  providers: [SettlementService, OrdersService, OrderNotificationsService, OrdersWatchdog, LoyaltyEarnedNotifier],
  exports: [SettlementService, OrdersService, OrderNotificationsService, OrdersWatchdog],
})
export class OrdersModule {}
