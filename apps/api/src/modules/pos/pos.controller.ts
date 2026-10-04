import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Headers } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ConnectPosSchema, UpdatePosSchema, UuidSchema } from '@resget/shared';
import type { ConnectPosInput, PosSettingsDTO, UpdatePosInput } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import {
  RequireFeature,
  RequirePermission,
  RestaurantScoped,
  SessionOnly,
} from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { badRequest } from '../../common/api-error';
import { PosService } from './pos.service';

/** The restaurant's POS connection (docs/POS_ENTEGRASYONU.md); credentials never leave the API unencrypted. */
@Controller('restaurants/:restaurantId/pos')
@RestaurantScoped()
@RequireFeature('pos_integration')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get()
  @RequirePermission('integrations.manage')
  settings(@Tenant() tenant: TenantContext): Promise<PosSettingsDTO> {
    return this.pos.settings(tenant.restaurantId);
  }

  @Put()
  @RequirePermission('integrations.manage')
  @SessionOnly()
  connect(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(ConnectPosSchema) body: ConnectPosInput,
  ): Promise<PosSettingsDTO> {
    return this.pos.connect(tenant.restaurantId, user.id, body);
  }

  @Patch()
  @RequirePermission('integrations.manage')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdatePosSchema) body: UpdatePosInput,
  ): Promise<PosSettingsDTO> {
    return this.pos.update(tenant.restaurantId, user.id, body);
  }

  @Delete()
  @RequirePermission('integrations.manage')
  @SessionOnly()
  disconnect(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser): Promise<PosSettingsDTO> {
    return this.pos.disconnect(tenant.restaurantId, user.id);
  }
}

/** Status updates from a POS, verified against the connection's signature before anything changes. */
@Controller('webhooks/pos')
export class PosWebhooksController {
  constructor(private readonly pos: PosService) {}

  @Post(':connectionId')
  @HttpCode(200)
  receive(
    @ZodParam('connectionId', UuidSchema) connectionId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<{ applied: boolean }> {
    const raw = req.rawBody?.toString('utf8');
    if (!raw) throw badRequest('WEBHOOK_INVALID', 'Empty body');
    return this.pos.handleWebhook(connectionId, raw, headers);
  }
}
