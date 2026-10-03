import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';
import { NotificationSettingsSchema, PurchaseCreditsSchema } from '@resget/shared';
import type { MessagingOverviewDTO, NotificationSettings, PurchaseCreditsResultDTO } from '@resget/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { MessagingService } from '../messaging/messaging.service';
import { CreditsService } from './credits.service';

/** Wallets, packages, notification settings and the message log of a restaurant. */
@Controller('restaurants/:restaurantId/messaging')
@RestaurantScoped()
export class MessagingController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly credits: CreditsService,
  ) {}

  @Get()
  @RequirePermission('messaging.manage')
  overview(@Tenant() tenant: TenantContext): Promise<MessagingOverviewDTO> {
    return this.messaging.overview(tenant.restaurantId);
  }

  @Patch('settings')
  @RequirePermission('messaging.manage')
  settings(
    @Tenant() tenant: TenantContext,
    @ZodBody(NotificationSettingsSchema) body: z.infer<typeof NotificationSettingsSchema>,
  ): Promise<NotificationSettings> {
    return this.messaging.updateSettings(tenant.restaurantId, body);
  }

  @Post('purchase')
  @HttpCode(200)
  @RequirePermission('subscription.manage')
  purchase(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(PurchaseCreditsSchema) body: z.infer<typeof PurchaseCreditsSchema>,
  ): Promise<PurchaseCreditsResultDTO> {
    return this.credits.purchase(tenant.restaurantId, user.id, body);
  }
}
