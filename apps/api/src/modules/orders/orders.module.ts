import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersController } from './orders.controller';
import { SettlementService } from './settlement.service';

@Module({
  imports: [AuthModule],
  controllers: [OrdersController],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class OrdersModule {}
