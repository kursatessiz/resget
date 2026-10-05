import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { PublicTabsController, TabsController } from './tabs.controller';
import { TabsService } from './tabs.service';

/** Open tab at the table (docs/ACIK_HESAP.md). */
@Module({
  imports: [OrdersModule, PaymentsModule],
  controllers: [TabsController, PublicTabsController],
  providers: [TabsService],
  exports: [TabsService],
})
export class TabsModule {}
