import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';
import { CreateWebhookSchema, UpdateWebhookSchema, UuidSchema } from '@resget/shared';
import type { CreatedWebhookDTO, WebhookDTO, WebhookDeliveryDTO } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import {
  RequireFeature,
  RequirePermission,
  RequirePlanFeature,
  RestaurantScoped,
  SessionOnly,
} from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { WebhooksService } from './webhooks.service';

/** Webhook endpoints of a restaurant (docs/API_ERISIMI.md); managed from the panel by a person, never by a key. */
@Controller('restaurants/:restaurantId/webhooks')
@RestaurantScoped()
@RequireFeature('api_access')
@SessionOnly()
@RequirePlanFeature('api_access')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @RequirePermission('integrations.manage')
  list(@Tenant() tenant: TenantContext): Promise<WebhookDTO[]> {
    return this.webhooks.list(tenant.restaurantId);
  }

  @Post()
  @RequirePermission('integrations.manage')
  create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateWebhookSchema) body: z.infer<typeof CreateWebhookSchema>,
  ): Promise<CreatedWebhookDTO> {
    return this.webhooks.create(tenant.restaurantId, user.id, body);
  }

  @Patch(':webhookId')
  @RequirePermission('integrations.manage')
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('webhookId', UuidSchema) id: string,
    @ZodBody(UpdateWebhookSchema) body: z.infer<typeof UpdateWebhookSchema>,
  ): Promise<WebhookDTO> {
    return this.webhooks.update(tenant.restaurantId, user.id, id, body);
  }

  @Delete(':webhookId')
  @HttpCode(204)
  @RequirePermission('integrations.manage')
  remove(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('webhookId', UuidSchema) id: string,
  ): Promise<void> {
    return this.webhooks.remove(tenant.restaurantId, user.id, id);
  }

  /** Queues a delivery with a sample body so the receiver can be checked before real orders flow. */
  @Post(':webhookId/test')
  @HttpCode(200)
  @RequirePermission('integrations.manage')
  test(@Tenant() tenant: TenantContext, @ZodParam('webhookId', UuidSchema) id: string): Promise<WebhookDeliveryDTO> {
    return this.webhooks.test(tenant.restaurantId, id);
  }

  /** A failed delivery goes back on the queue under the same id (docs/API_ERISIMI.md, "Yeniden gönderme"). */
  @Post(':webhookId/deliveries/:deliveryId/redeliver')
  @HttpCode(200)
  @RequirePermission('integrations.manage')
  redeliver(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('webhookId', UuidSchema) id: string,
    @ZodParam('deliveryId', UuidSchema) deliveryId: string,
  ): Promise<WebhookDeliveryDTO> {
    return this.webhooks.redeliver(tenant.restaurantId, user.id, id, deliveryId);
  }

  @Get(':webhookId/deliveries')
  @RequirePermission('integrations.manage')
  deliveries(
    @Tenant() tenant: TenantContext,
    @ZodParam('webhookId', UuidSchema) id: string,
  ): Promise<WebhookDeliveryDTO[]> {
    return this.webhooks.deliveries(tenant.restaurantId, id);
  }
}
