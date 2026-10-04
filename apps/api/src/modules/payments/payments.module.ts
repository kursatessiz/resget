import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsController } from './payments.controller';
import { CardsController } from './cards.controller';
import { MealCardsController } from './meal-cards.controller';
import { OrderPaymentsController, PaymentWebhooksController, PublicPaymentsController } from './checkout.controller';
import { PaymentsRegistry } from './payments.registry';
import { PaymentsService } from './payments.service';
import { MealCardsRegistry } from './meal-cards.registry';
import { MealCardsService } from './meal-cards.service';
import { CheckoutService } from './checkout.service';
import { RefundsService } from './refunds.service';

@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [
    PaymentsController,
    CardsController,
    MealCardsController,
    OrderPaymentsController,
    PublicPaymentsController,
    PaymentWebhooksController,
  ],
  providers: [PaymentsRegistry, PaymentsService, MealCardsRegistry, MealCardsService, CheckoutService, RefundsService],
  exports: [PaymentsRegistry, PaymentsService, MealCardsService, CheckoutService, RefundsService],
})
export class PaymentsModule {}
