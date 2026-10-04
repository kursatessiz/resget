import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { PosController, PosWebhooksController } from './pos.controller';
import { PosService } from './pos.service';
import { PosWatchdog } from './pos.watchdog';

@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [PosController, PosWebhooksController],
  providers: [PosService, PosWatchdog],
  exports: [PosService, PosWatchdog],
})
export class PosModule {}
