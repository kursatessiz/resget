import { Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { UuidSchema } from '@resget/shared';
import type { QrFunnel } from '@resget/shared';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { TablesService } from './tables.service';
import type { TableDTO } from './tables.service';

const CreateTableSchema = z.object({ branchId: UuidSchema, label: z.string().trim().min(1).max(20) }).strict();
const FunnelQuerySchema = z
  .object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })
  .strict()
  .transform((q) => {
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 30 * 86400000);
    return { from, to };
  });

@Controller('restaurants/:restaurantId/tables')
@RestaurantScoped()
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  @RequirePermission('tables.manage')
  list(@Tenant() tenant: TenantContext): Promise<TableDTO[]> {
    return this.tables.list(tenant.restaurantId);
  }

  @Post()
  @RequirePermission('tables.manage')
  create(
    @Tenant() tenant: TenantContext,
    @ZodBody(CreateTableSchema) body: z.infer<typeof CreateTableSchema>,
  ): Promise<TableDTO> {
    return this.tables.create(tenant.restaurantId, body.branchId, body.label);
  }

  @Post(':tableId/regenerate')
  @RequirePermission('tables.manage')
  regenerate(@Tenant() tenant: TenantContext, @Param('tableId') tableId: string): Promise<TableDTO> {
    return this.tables.regenerate(tenant.restaurantId, UuidSchema.parse(tableId));
  }

  /** The acquisition KPI of phase 0: how many menu views become orders and registrations. */
  @Get('funnel')
  @RequirePermission('reports.view')
  funnel(
    @Tenant() tenant: TenantContext,
    @ZodQuery(FunnelQuerySchema) range: z.infer<typeof FunnelQuerySchema>,
  ): Promise<QrFunnel> {
    return this.tables.funnel(tenant.restaurantId, range.from, range.to);
  }
}
