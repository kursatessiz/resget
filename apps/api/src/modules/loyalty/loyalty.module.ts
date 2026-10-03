import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

/** Loyalty points; global so orders, the storefront, the account and the customer list share one writer. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
