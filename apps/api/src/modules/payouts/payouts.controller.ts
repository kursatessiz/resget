import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { z } from 'zod';
import {
  AdminPayoutQuerySchema,
  PayoutFailedSchema,
  PayoutRunSchema,
  PayoutSentSchema,
  UuidSchema,
} from '@resget/shared';
import type { AdminPayoutDTO, AdminPayoutPageDTO, FinanceLedgerDTO, PayoutRunReportDTO } from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { PayoutsService } from './payouts.service';

/** The restaurant's ledger and payouts (docs/MUTABAKAT.md). */
@Controller('restaurants/:restaurantId/finance')
@RestaurantScoped()
export class FinanceController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get('ledger')
  @RequirePermission('finance.view')
  ledger(@Tenant() tenant: TenantContext): Promise<FinanceLedgerDTO> {
    return this.payouts.ledger(tenant.restaurantId);
  }
}

/** Platform owner only: every payout, closing the week on demand, marking transfers. */
@Controller('admin/payouts')
@SuperAdminOnly()
export class AdminPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get()
  list(@ZodQuery(AdminPayoutQuerySchema) query: z.infer<typeof AdminPayoutQuerySchema>): Promise<AdminPayoutPageDTO> {
    return this.payouts.list(query);
  }

  @Post('run')
  @HttpCode(200)
  run(@ZodBody(PayoutRunSchema) body: z.infer<typeof PayoutRunSchema>): Promise<PayoutRunReportDTO> {
    return this.payouts.rollDue(body.asOf ? new Date(body.asOf) : new Date());
  }

  @Post(':id/sent')
  @HttpCode(200)
  sent(
    @CurrentUser() user: AuthUser,
    @ZodParam('id', UuidSchema) id: string,
    @ZodBody(PayoutSentSchema) body: z.infer<typeof PayoutSentSchema>,
  ): Promise<AdminPayoutDTO> {
    return this.payouts.markSent(user.id, id, body.providerRef);
  }

  @Post(':id/settled')
  @HttpCode(200)
  settled(@CurrentUser() user: AuthUser, @ZodParam('id', UuidSchema) id: string): Promise<AdminPayoutDTO> {
    return this.payouts.markSettled(user.id, id);
  }

  @Post(':id/failed')
  @HttpCode(200)
  failed(
    @CurrentUser() user: AuthUser,
    @ZodParam('id', UuidSchema) id: string,
    @ZodBody(PayoutFailedSchema) body: z.infer<typeof PayoutFailedSchema>,
  ): Promise<AdminPayoutDTO> {
    return this.payouts.markFailed(user.id, id, body.reason);
  }
}
