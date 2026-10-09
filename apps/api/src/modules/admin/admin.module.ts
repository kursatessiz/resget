import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { CourierModule } from '../courier/courier.module';
import { PaymentsModule } from '../payments/payments.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import { AdminController } from './admin.controller';
import { PlansAdminController } from './plans-admin.controller';
import { PlansAdminService } from './plans-admin.service';
import { AdminService } from './admin.service';
import { SystemHealthService } from './system-health.service';

@Module({
  imports: [AuthModule, RestaurantsModule, PaymentsModule, CourierModule, BillingModule],
  controllers: [AdminController, PlansAdminController],
  providers: [AdminService, SystemHealthService, PlansAdminService],
  exports: [AdminService],
})
export class AdminModule {}
