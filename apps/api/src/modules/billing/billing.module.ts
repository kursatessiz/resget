import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminBillingController } from './admin-billing.controller';
import { BillingController } from './billing.controller';
import { BillingScheduler } from './billing.scheduler';
import { BillingService } from './billing.service';
import { INVOICE_PROVIDER, MockInvoiceProvider } from './invoice-provider';

/**
 * Commission billing (docs/FATURALAMA.md). The fiscal document integrator is
 * chosen by INVOICE_PROVIDER; MOCK is the only one until an integrator
 * contract exists, and a real one is a new adapter registered here.
 */
@Module({
  imports: [AuthModule, PaymentsModule, PayoutsModule],
  controllers: [BillingController, AdminBillingController],
  providers: [
    BillingService,
    BillingScheduler,
    { provide: INVOICE_PROVIDER, useFactory: () => new MockInvoiceProvider() },
  ],
  exports: [BillingService],
})
export class BillingModule {}
