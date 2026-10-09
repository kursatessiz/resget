import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { CourierModule } from '../courier/courier.module';
import { LedgerModule } from '../ledger/ledger.module';
import { CourierRequestsController, CourierWebhooksController } from './courier-requests.controller';
import { CourierRequestsService } from './courier-requests.service';

/** Calling a courier network for an order and following its delivery (docs/KURYE.md). */
@Module({
  imports: [AuthModule, OrdersModule, CourierModule, LedgerModule],
  controllers: [CourierRequestsController, CourierWebhooksController],
  providers: [CourierRequestsService],
})
export class CourierRequestsModule {}
