import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { z } from 'zod';
import { AdminInvoiceQuerySchema, BillingRunSchema, MarkInvoicePaidSchema, UuidSchema } from '@resget/shared';
import type { AdminInvoiceDTO, AdminInvoicePageDTO, BillingRunReportDTO, PayInvoiceResultDTO } from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { BillingService } from './billing.service';

/** Platform owner only: every invoice, the daily job on demand, transfers and voids. */
@Controller('admin/billing')
@SuperAdminOnly()
export class AdminBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('invoices')
  invoices(
    @ZodQuery(AdminInvoiceQuerySchema) query: z.infer<typeof AdminInvoiceQuerySchema>,
  ): Promise<AdminInvoicePageDTO> {
    return this.billing.list(query);
  }

  @Post('run')
  @HttpCode(200)
  run(@ZodBody(BillingRunSchema) body: z.infer<typeof BillingRunSchema>): Promise<BillingRunReportDTO> {
    return this.billing.runDaily(body.asOf ? new Date(body.asOf) : new Date());
  }

  @Post('invoices/:id/mark-paid')
  @HttpCode(200)
  markPaid(
    @CurrentUser() user: AuthUser,
    @ZodParam('id', UuidSchema) id: string,
    @ZodBody(MarkInvoicePaidSchema) body: z.infer<typeof MarkInvoicePaidSchema>,
  ): Promise<AdminInvoiceDTO> {
    return this.billing.markPaid(user.id, id, body.paymentRef);
  }

  @Post('invoices/:id/void')
  @HttpCode(200)
  voidInvoice(@CurrentUser() user: AuthUser, @ZodParam('id', UuidSchema) id: string): Promise<AdminInvoiceDTO> {
    return this.billing.voidInvoice(user.id, id);
  }

  @Post('invoices/:id/collect')
  @HttpCode(200)
  collect(@CurrentUser() user: AuthUser, @ZodParam('id', UuidSchema) id: string): Promise<PayInvoiceResultDTO> {
    return this.billing.collectNow(user.id, id);
  }
}
