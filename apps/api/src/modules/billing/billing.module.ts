import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminBillingController } from './admin-billing.controller';
import { BillingController } from './billing.controller';
import { BillingScheduler } from './billing.scheduler';
import { BillingService } from './billing.service';
import { INVOICE_PROVIDER, MockInvoiceProvider, UnavailableInvoiceProvider } from './invoice-provider';

/**
 * Commission billing (docs/FATURALAMA.md). The fiscal document integrator is
 * chosen by INVOICE_PROVIDER; MOCK numbers documents outside production and
 * production issues none until an integrator contract exists. A real one is
 * a new adapter registered here.
 */
@Module({
  imports: [AuthModule, PaymentsModule, PayoutsModule],
  controllers: [BillingController, AdminBillingController],
  providers: [
    BillingService,
    BillingScheduler,
    {
      provide: INVOICE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('NODE_ENV') === 'production' ? new UnavailableInvoiceProvider() : new MockInvoiceProvider(),
    },
  ],
  exports: [BillingService, INVOICE_PROVIDER],
})
export class BillingModule {}
