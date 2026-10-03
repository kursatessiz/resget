import { Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CommissionPeriodSchema, ConnectOwnPosSchema, UpdatePaymentModeSchema, UuidSchema } from '@resget/shared';
import type { CommissionStatement, PaymentSettingsDTO } from '@resget/shared';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { PaymentsService } from './payments.service';

const PeriodQuerySchema = z.object({ year: z.coerce.number(), month: z.coerce.number() }).pipe(CommissionPeriodSchema);

@Controller('restaurants/:restaurantId/payments')
@RestaurantScoped()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('settings')
  @RequirePermission('payments.manage')
  settings(@Tenant() tenant: TenantContext): Promise<PaymentSettingsDTO> {
    return this.payments.settings(tenant.restaurantId);
  }

  /** Credentials go in, a masked label comes out; they are never readable again through the API. */
  @Put('connection')
  @RequirePermission('payments.manage')
  connect(
    @Tenant() tenant: TenantContext,
    @ZodBody(ConnectOwnPosSchema) body: z.infer<typeof ConnectOwnPosSchema>,
  ): Promise<PaymentSettingsDTO> {
    return this.payments.connectOwnPos(tenant.restaurantId, body);
  }

  @Delete('connection')
  @HttpCode(200)
  @RequirePermission('payments.manage')
  disconnect(@Tenant() tenant: TenantContext): Promise<PaymentSettingsDTO> {
    return this.payments.disconnectOwnPos(tenant.restaurantId);
  }

  @Put('mode')
  @RequirePermission('payments.manage')
  setMode(
    @Tenant() tenant: TenantContext,
    @ZodBody(UpdatePaymentModeSchema) body: z.infer<typeof UpdatePaymentModeSchema>,
  ): Promise<PaymentSettingsDTO> {
    return this.payments.setPaymentMode(tenant.restaurantId, body.paymentMode);
  }

  /** The commission statement of a month (what the monthly invoice will contain). */
  @Get('commission')
  @RequirePermission('invoices.view')
  commission(
    @Tenant() tenant: TenantContext,
    @ZodQuery(PeriodQuerySchema) period: z.infer<typeof PeriodQuerySchema>,
  ): Promise<CommissionStatement> {
    return this.payments.commissionStatement(tenant.restaurantId, period.year, period.month);
  }
}
