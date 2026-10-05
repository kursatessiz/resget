import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AccountingPeriodSchema, accountingFileName } from '@resget/shared';
import type { AccountingPeriod } from '@resget/shared';
import { ZodQuery } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { AccountingService } from './accounting.service';

/** A month of orders and lines as CSV for the accountant (docs/MUHASEBE_AKTARIMI.md). */
@Controller('restaurants/:restaurantId/accounting')
@RestaurantScoped()
@RequireFeature('accounting_export')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  private send(res: Response, name: string, body: string): string {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${name}"`);
    res.setHeader('cache-control', 'no-store');
    return body;
  }

  @Get('orders.csv')
  @RequirePermission('finance.view')
  async orders(
    @Tenant() tenant: TenantContext,
    @ZodQuery(AccountingPeriodSchema) period: AccountingPeriod,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    return this.send(
      res,
      accountingFileName('orders', period),
      await this.accounting.ordersCsv(tenant.restaurantId, period),
    );
  }

  @Get('lines.csv')
  @RequirePermission('finance.view')
  async lines(
    @Tenant() tenant: TenantContext,
    @ZodQuery(AccountingPeriodSchema) period: AccountingPeriod,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    return this.send(
      res,
      accountingFileName('lines', period),
      await this.accounting.linesCsv(tenant.restaurantId, period),
    );
  }
}
