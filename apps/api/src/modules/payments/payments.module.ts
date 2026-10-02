import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentsController } from './payments.controller';
import { CardsController } from './cards.controller';
import { PaymentsRegistry } from './payments.registry';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule],
  controllers: [PaymentsController, CardsController],
  providers: [PaymentsRegistry, PaymentsService],
  exports: [PaymentsRegistry, PaymentsService],
})
export class PaymentsModule {}
