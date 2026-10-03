import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { MessagingController } from './credits.controller';
import { CreditsService } from './credits.service';

@Module({ imports: [AuthModule, PaymentsModule], controllers: [MessagingController], providers: [CreditsService] })
export class CreditsModule {}
