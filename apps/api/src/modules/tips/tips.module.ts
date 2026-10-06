import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { CourierModule } from '../courier/courier.module';
import { PushModule } from '../push/push.module';
import { PublicRateLimitGuard } from '../storefront/public-rate-limit.guard';
import { PublicTipsController, TipsController } from './tips.controller';
import { TipsService } from './tips.service';

/** Courier tips (docs/BAHSIS.md). */
@Module({
  imports: [AuthModule, OrdersModule, PaymentsModule, CourierModule, PushModule],
  controllers: [TipsController, PublicTipsController],
  providers: [TipsService, PublicRateLimitGuard],
})
export class TipsModule {}
