import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import {
  AdminPayoutQuerySchema,
  ChoosePayoutScheduleSchema,
  UpsertPayoutScheduleOptionSchema,
  PayoutFailedSchema,
  PayoutRunSchema,
  PayoutSentSchema,
  UuidSchema,
} from '@resget/shared';
import type {
  AdminPayoutDTO,
  AdminPayoutPageDTO,
  ChoosePayoutScheduleInput,
  FinanceLedgerDTO,
  InstantPayoutQuoteDTO,
  PayoutDTO,
  PayoutRunReportDTO,
  PayoutScheduleDTO,
  PayoutScheduleOptionDTO,
  UpsertPayoutScheduleOptionInput,
} from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
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

  /** Payout schedules (docs/HAKEDIS_TAKVIMI.md): the options, the chosen schedule and instant payouts. */
  @Get('payout-schedule')
  @RequirePermission('finance.view')
  @RequireFeature('payout_schedules')
  schedule(@Tenant() tenant: TenantContext): Promise<PayoutScheduleDTO> {
    return this.payouts.schedule(tenant.restaurantId);
  }

  @Put('payout-schedule')
  @RequirePermission('payments.manage')
  @RequireFeature('payout_schedules')
  choose(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(ChoosePayoutScheduleSchema) body: ChoosePayoutScheduleInput,
  ): Promise<PayoutScheduleDTO> {
    return this.payouts.choose(tenant.restaurantId, body.cadence, user.id);
  }

  @Get('payouts/instant/quote')
  @RequirePermission('finance.view')
  @RequireFeature('payout_schedules')
  quote(@Tenant() tenant: TenantContext): Promise<InstantPayoutQuoteDTO> {
    return this.payouts.instantQuote(tenant.restaurantId);
  }

  @Post('payouts/instant')
  @RequirePermission('payments.manage')
  @RequireFeature('payout_schedules')
  instant(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser): Promise<PayoutDTO> {
    return this.payouts.instant(tenant.restaurantId, user.id);
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

  @Get('options')
  options(): Promise<PayoutScheduleOptionDTO[]> {
    return this.payouts.options();
  }

  @Put('options')
  saveOption(
    @CurrentUser() user: AuthUser,
    @ZodBody(UpsertPayoutScheduleOptionSchema) body: UpsertPayoutScheduleOptionInput,
  ): Promise<PayoutScheduleOptionDTO[]> {
    return this.payouts.upsertOption(user.id, body);
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
