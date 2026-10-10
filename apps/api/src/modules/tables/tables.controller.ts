import { Controller, Get, Header, Patch, Post, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import { CreateTableSchema, QR_FUNNEL_MAX_SPAN_DAYS, UpdateTableSchema, UuidSchema } from '@resget/shared';
import type { QrFunnel, TableDTO } from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { TablesService } from './tables.service';

const FunnelQuerySchema = z
  .object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })
  .strict()
  .transform((q, ctx) => {
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 30 * 86400000);
    // A wider range is refused instead of clamped so the caller learns the window it actually got.
    if (to.getTime() - from.getTime() > QR_FUNNEL_MAX_SPAN_DAYS * 86400000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: `range is limited to ${QR_FUNNEL_MAX_SPAN_DAYS} days`,
      });
      return z.NEVER;
    }
    return { from, to };
  });

@Controller('restaurants/:restaurantId/tables')
@RestaurantScoped()
@RequireFeature('table_qr')
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

  /** The acquisition KPI of phase 0: how many menu views become orders and registrations. */
  @Get('funnel')
  @RequirePermission('reports.view')
  funnel(
    @Tenant() tenant: TenantContext,
    @ZodQuery(FunnelQuerySchema) range: z.infer<typeof FunnelQuerySchema>,
  ): Promise<QrFunnel> {
    return this.tables.funnel(tenant.restaurantId, range.from, range.to);
  }

  @Patch(':tableId')
  @RequirePermission('tables.manage')
  update(
    @Tenant() tenant: TenantContext,
    @ZodParam('tableId', UuidSchema) tableId: string,
    @ZodBody(UpdateTableSchema) body: z.infer<typeof UpdateTableSchema>,
  ): Promise<TableDTO> {
    return this.tables.update(tenant.restaurantId, tableId, body);
  }

  @Post(':tableId/regenerate')
  @RequirePermission('tables.manage')
  regenerate(@Tenant() tenant: TenantContext, @ZodParam('tableId', UuidSchema) tableId: string): Promise<TableDTO> {
    return this.tables.regenerate(tenant.restaurantId, tableId);
  }

  /** Printable sticker (name, QR, table, caption) as a scalable image. */
  @Get(':tableId/label.svg')
  @Header('cache-control', 'no-store')
  @RequirePermission('tables.manage')
  async labelSvg(
    @Tenant() tenant: TenantContext,
    @ZodParam('tableId', UuidSchema) tableId: string,
  ): Promise<StreamableFile> {
    const { svg, filename } = await this.tables.labelSvg(tenant.restaurantId, tableId);
    return new StreamableFile(Buffer.from(svg, 'utf8'), {
      type: 'image/svg+xml; charset=utf-8',
      disposition: `attachment; filename="${filename}.svg"`,
    });
  }

  /** The bare QR as a raster image for print shops and sticker tools. */
  @Get(':tableId/qr.png')
  @Header('cache-control', 'no-store')
  @RequirePermission('tables.manage')
  async qrPng(
    @Tenant() tenant: TenantContext,
    @ZodParam('tableId', UuidSchema) tableId: string,
  ): Promise<StreamableFile> {
    const { png, filename } = await this.tables.qrPng(tenant.restaurantId, tableId);
    return new StreamableFile(png, { type: 'image/png', disposition: `attachment; filename="${filename}.png"` });
  }
}
