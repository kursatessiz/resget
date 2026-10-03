import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import { PayInvoiceSchema, SetBillingCardSchema, UuidSchema } from '@resget/shared';
import type { BillingOverviewDTO, PayInvoiceResultDTO } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { BillingService } from './billing.service';

/** The restaurant's side of commission billing: invoices, the billing card, paying now. */
@Controller('restaurants/:restaurantId/billing')
@RestaurantScoped()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequirePermission('invoices.view')
  overview(@Tenant() tenant: TenantContext): Promise<BillingOverviewDTO> {
    return this.billing.overview(tenant.restaurantId);
  }

  @Put('card')
  @RequirePermission('payments.manage')
  setCard(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(SetBillingCardSchema) body: z.infer<typeof SetBillingCardSchema>,
  ): Promise<BillingOverviewDTO> {
    return this.billing.setBillingCard(tenant.restaurantId, user.id, body.paymentMethodId);
  }

  @Post('invoices/:invoiceId/pay')
  @HttpCode(200)
  @RequirePermission('payments.manage')
  pay(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('invoiceId', UuidSchema) invoiceId: string,
    @ZodBody(PayInvoiceSchema) body: z.infer<typeof PayInvoiceSchema>,
  ): Promise<PayInvoiceResultDTO> {
    return this.billing.pay(tenant.restaurantId, user.id, invoiceId, body);
  }
}
