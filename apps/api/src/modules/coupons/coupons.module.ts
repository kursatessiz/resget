import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';
import { MyReferralsController, ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

/** Coupons and the referrals built on them; global so orders and the storefront share one writer of the use counter. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [CouponsController, ReferralsController, MyReferralsController],
  providers: [CouponsService, ReferralsService],
  exports: [CouponsService, ReferralsService],
})
export class CouponsModule {}
