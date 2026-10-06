import { Controller, Get, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { UuidSchema } from '@resget/shared';
import type { CourierNetworkStatusDTO, OrderDetailDTO } from '@resget/shared';
import { ZodParam } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { badRequest } from '../../common/api-error';
import { CourierRequestsService } from './courier-requests.service';
import type { CourierWebhookOutcome } from './courier-requests.service';

const ProviderCodeSchema = z.string().regex(/^[A-Z0-9_]{2,32}$/);

/** Calling a courier network from the order screen (docs/KURYE.md, "Kurye çağırma"). */
@Controller('restaurants/:restaurantId')
@RestaurantScoped()
export class CourierRequestsController {
  constructor(private readonly requests: CourierRequestsService) {}

  @Get('courier/network')
  @RequirePermission('dispatch.manage')
  network(@Tenant() tenant: TenantContext): Promise<CourierNetworkStatusDTO> {
    return this.requests.networkStatus(tenant.restaurantId);
  }

  @Post('orders/:orderId/courier-request')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  @RequireFeature('courier_network')
  call(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('orderId', UuidSchema) orderId: string,
  ): Promise<OrderDetailDTO> {
    return this.requests.call(tenant.restaurantId, orderId, user.id, tenant.permissions.has('customers.contact.view'));
  }

  @Post('orders/:orderId/courier-request/cancel')
  @HttpCode(200)
  @RequirePermission('dispatch.manage')
  @RequireFeature('courier_network')
  cancel(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('orderId', UuidSchema) orderId: string,
  ): Promise<OrderDetailDTO> {
    return this.requests.cancel(
      tenant.restaurantId,
      orderId,
      user.id,
      tenant.permissions.has('customers.contact.view'),
    );
  }
}

/** Courier network notifications; unauthenticated by nature, every request is verified by the network's adapter. */
@Controller('webhooks/courier')
export class CourierWebhooksController {
  constructor(private readonly requests: CourierRequestsService) {}

  @Post(':providerCode')
  @HttpCode(200)
  receive(
    @ZodParam('providerCode', ProviderCodeSchema) providerCode: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<CourierWebhookOutcome> {
    const raw = req.rawBody?.toString('utf8');
    if (!raw) throw badRequest('WEBHOOK_INVALID', 'Empty body');
    return this.requests.handleWebhook(providerCode, raw, headers);
  }
}
