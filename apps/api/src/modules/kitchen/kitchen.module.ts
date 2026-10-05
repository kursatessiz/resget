import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';

/** The kitchen display (docs/MUTFAK_EKRANI.md). */
@Module({
  imports: [OrdersModule],
  controllers: [KitchenController],
  providers: [KitchenService],
})
export class KitchenModule {}
