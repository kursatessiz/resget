import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPayoutsController, FinanceController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [AuthModule],
  controllers: [FinanceController, AdminPayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
