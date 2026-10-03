import { Controller, Get, Header } from '@nestjs/common';
import type { z } from 'zod';
import { ReportsQuerySchema } from '@resget/shared';
import type { ReportSummaryDTO } from '@resget/shared';
import { ZodQuery } from '../../common/zod-body.pipe';
import {
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { ReportsService } from './reports.service';

/** Restaurant reports; BASIC sees 30 days, PRO (`analytics`) a year and the CSV export. */
@Controller('restaurants/:restaurantId/reports')
@RestaurantScoped()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @RequirePermission('reports.view')
  summary(
    @Tenant() tenant: TenantContext,
    @ZodQuery(ReportsQuerySchema) query: z.infer<typeof ReportsQuerySchema>,
  ): Promise<ReportSummaryDTO> {
    return this.reports.summary(tenant.restaurantId, query.days, tenant.effectivePlan === 'PRO');
  }

  @Get('orders.csv')
  @RequirePermission('reports.view')
  @RequirePlanFeature('analytics')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="orders.csv"')
  @Header('cache-control', 'no-store')
  csv(
    @Tenant() tenant: TenantContext,
    @ZodQuery(ReportsQuerySchema) query: z.infer<typeof ReportsQuerySchema>,
  ): Promise<string> {
    return this.reports.ordersCsv(tenant.restaurantId, query.days);
  }
}
