import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { z } from 'zod';
import { CreateApiKeySchema, UuidSchema } from '@resget/shared';
import type { ApiKeyDTO, CreatedApiKeyDTO } from '@resget/shared';
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
import { ApiKeysService } from '../auth/api-keys.service';

/** Minting and revoking keys needs a person at the panel: a key can never create another key. */
@Controller('restaurants/:restaurantId/api-keys')
@RestaurantScoped()
@RequireFeature('api_access')
@SessionOnly()
@RequirePlanFeature('api_access')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @RequirePermission('integrations.manage')
  list(@Tenant() tenant: TenantContext): Promise<ApiKeyDTO[]> {
    return this.apiKeys.list(tenant.restaurantId);
  }

  @Post()
  @RequirePermission('integrations.manage')
  create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateApiKeySchema) body: z.infer<typeof CreateApiKeySchema>,
  ): Promise<CreatedApiKeyDTO> {
    return this.apiKeys.create(tenant, user, body);
  }

  @Post(':keyId/revoke')
  @HttpCode(200)
  @RequirePermission('integrations.manage')
  revoke(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('keyId', UuidSchema) id: string,
  ): Promise<ApiKeyDTO> {
    return this.apiKeys.revoke(tenant, user, id);
  }
}
