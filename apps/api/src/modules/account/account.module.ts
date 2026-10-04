import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { PrivacyService } from './privacy.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [AccountController],
  providers: [AccountService, PrivacyService],
})
export class AccountModule {}
