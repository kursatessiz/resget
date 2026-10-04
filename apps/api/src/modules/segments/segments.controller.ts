import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { CreateSegmentSchema, PreviewSegmentSchema, UpdateSegmentSchema, UuidSchema } from '@resget/shared';
import type {
  CreateSegmentInput,
  PreviewSegmentInput,
  SegmentDTO,
  SegmentListDTO,
  SegmentPreviewDTO,
  UpdateSegmentInput,
} from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import {
  RequireFeature,
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
} from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { SegmentsService } from './segments.service';

/** Saved audiences with an AND / OR rule language (docs/SEGMENTLER.md); PRO campaigns. */
@Controller('restaurants/:restaurantId/segments')
@RestaurantScoped()
@RequireFeature('segments_v2')
@RequirePlanFeature('campaigns')
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @Get()
  @RequirePermission('campaigns.view')
  list(@Tenant() tenant: TenantContext): Promise<SegmentListDTO> {
    return this.segments.list(tenant.restaurantId);
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermission('campaigns.view')
  preview(
    @Tenant() tenant: TenantContext,
    @ZodBody(PreviewSegmentSchema) body: PreviewSegmentInput,
  ): Promise<SegmentPreviewDTO> {
    return this.segments.preview(tenant.restaurantId, body.rule, tenant.permissions.has('customers.contact.view'));
  }

  @Post()
  @RequirePermission('campaigns.manage')
  create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateSegmentSchema) body: CreateSegmentInput,
  ): Promise<SegmentDTO> {
    return this.segments.create(tenant.restaurantId, user.id, body);
  }

  @Get(':segmentId')
  @RequirePermission('campaigns.view')
  get(@Tenant() tenant: TenantContext, @ZodParam('segmentId', UuidSchema) segmentId: string): Promise<SegmentDTO> {
    return this.segments.get(tenant.restaurantId, segmentId);
  }

  @Patch(':segmentId')
  @RequirePermission('campaigns.manage')
  update(
    @Tenant() tenant: TenantContext,
    @ZodParam('segmentId', UuidSchema) segmentId: string,
    @ZodBody(UpdateSegmentSchema) body: UpdateSegmentInput,
  ): Promise<SegmentDTO> {
    return this.segments.update(tenant.restaurantId, segmentId, body);
  }

  @Post(':segmentId/snapshot')
  @HttpCode(200)
  @RequirePermission('campaigns.manage')
  snapshot(@Tenant() tenant: TenantContext, @ZodParam('segmentId', UuidSchema) segmentId: string): Promise<SegmentDTO> {
    return this.segments.snapshot(tenant.restaurantId, segmentId);
  }

  @Delete(':segmentId')
  @HttpCode(204)
  @RequirePermission('campaigns.manage')
  async remove(@Tenant() tenant: TenantContext, @ZodParam('segmentId', UuidSchema) segmentId: string): Promise<void> {
    await this.segments.remove(tenant.restaurantId, segmentId);
  }
}
