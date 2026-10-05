import { Controller, Get, Put } from '@nestjs/common';
import { AuditQuerySchema, UpdateSendLimitSchema, UuidSchema } from '@resget/shared';
import type { AuditPageDTO, AuditQuery, SendLimitDTO, UpdateSendLimitInput } from '@resget/shared';
import { notFound } from '../../common/api-error';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { CampaignGuardsService } from '../campaigns/campaign-guards.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditViewerService } from './audit-viewer.service';

/** Send limits per tenant and the audit viewer, for the platform owner (docs/ONAYLAR.md). */
@Controller('admin')
@SuperAdminOnly()
export class GovernanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guards: CampaignGuardsService,
    private readonly audit: AuditViewerService,
  ) {}

  @Get('audit')
  list(@ZodQuery(AuditQuerySchema) query: AuditQuery): Promise<AuditPageDTO> {
    return this.audit.list(query);
  }

  @Get('send-limits/:restaurantId')
  async limit(@ZodParam('restaurantId', UuidSchema) restaurantId: string): Promise<SendLimitDTO> {
    await this.requireRestaurant(restaurantId);
    return this.guards.limitOf(restaurantId, new Date());
  }

  @Put('send-limits/:restaurantId')
  async setLimit(
    @CurrentUser() user: AuthUser,
    @ZodParam('restaurantId', UuidSchema) restaurantId: string,
    @ZodBody(UpdateSendLimitSchema) body: UpdateSendLimitInput,
  ): Promise<SendLimitDTO> {
    await this.requireRestaurant(restaurantId);
    return this.guards.setLimit(restaurantId, user.id, body, new Date());
  }

  private async requireRestaurant(id: string): Promise<void> {
    const found = await this.prisma.restaurant.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw notFound('RESTAURANT_NOT_FOUND', 'Restaurant not found');
  }
}
