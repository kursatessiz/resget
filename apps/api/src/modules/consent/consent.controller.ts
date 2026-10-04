import { Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import {
  ConsentTokenSchema,
  RecordOptOutSchema,
  SetBusinessSchema,
  UpdateConsentLimitsSchema,
  UpdateConsentPolicySchema,
  UuidSchema,
} from '@resget/shared';
import type {
  ConsentConfirmResultDTO,
  ConsentSettingsDTO,
  ContactConsentDTO,
  RecordOptOutInput,
  SetBusinessInput,
  UpdateConsentLimitsInput,
  UpdateConsentPolicyInput,
} from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { PublicRateLimitGuard, RateLimit } from '../storefront/public-rate-limit.guard';
import { ConsentService } from './consent.service';

/** A contact's consent history, the restaurant's caps (docs/RIZA.md). */
@Controller('restaurants/:restaurantId/consent')
@RestaurantScoped()
@RequireFeature('consent_v2')
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Get('settings')
  @RequirePermission('campaigns.view')
  settings(@Tenant() tenant: TenantContext): Promise<ConsentSettingsDTO> {
    return this.consent.settings(tenant.restaurantId);
  }

  @Put('settings')
  @RequirePermission('campaigns.manage')
  updateLimits(
    @Tenant() tenant: TenantContext,
    @ZodBody(UpdateConsentLimitsSchema) body: UpdateConsentLimitsInput,
  ): Promise<ConsentSettingsDTO> {
    return this.consent.updateLimits(tenant.restaurantId, body);
  }

  @Get('customers/:customerId')
  @RequirePermission('customers.view')
  contact(
    @Tenant() tenant: TenantContext,
    @ZodParam('customerId', UuidSchema) customerId: string,
  ): Promise<ContactConsentDTO> {
    return this.consent.contactConsent(tenant.restaurantId, customerId);
  }

  /** Staff record a refusal the customer gave them; nobody but the customer can say yes. */
  @Post('customers/:customerId/opt-out')
  @HttpCode(200)
  @RequirePermission('customers.manage')
  optOut(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodParam('customerId', UuidSchema) customerId: string,
    @ZodBody(RecordOptOutSchema) body: RecordOptOutInput,
  ): Promise<ContactConsentDTO> {
    return this.consent.staffOptOut(tenant.restaurantId, customerId, body.channels, body.note, user.id);
  }

  @Put('customers/:customerId/business')
  @RequirePermission('customers.manage')
  business(
    @Tenant() tenant: TenantContext,
    @ZodParam('customerId', UuidSchema) customerId: string,
    @ZodBody(SetBusinessSchema) body: SetBusinessInput,
  ): Promise<ContactConsentDTO> {
    return this.consent.setBusiness(tenant.restaurantId, customerId, body.isBusiness);
  }
}

/** The platform owner's per-tenant switches: double opt-in regions and the TR merchant exemption. */
@Controller('admin/restaurants/:restaurantId/consent-policy')
@SuperAdminOnly()
export class AdminConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Get()
  get(@ZodParam('restaurantId', UuidSchema) restaurantId: string): Promise<ConsentSettingsDTO> {
    return this.consent.settings(restaurantId);
  }

  @Put()
  update(
    @ZodParam('restaurantId', UuidSchema) restaurantId: string,
    @ZodBody(UpdateConsentPolicySchema) body: UpdateConsentPolicyInput,
  ): Promise<ConsentSettingsDTO> {
    return this.consent.updatePolicy(restaurantId, body);
  }
}

/** The confirmation link's button posts here; the answer never says why a link is invalid. */
@Controller('public/consent')
@UseGuards(PublicRateLimitGuard)
export class ConsentConfirmController {
  constructor(private readonly consent: ConsentService) {}

  @Post('confirm/:token')
  @HttpCode(200)
  @RateLimit({ bucket: 'consent', limit: 20, windowSeconds: 600 })
  confirm(@ZodParam('token', ConsentTokenSchema) token: string): Promise<ConsentConfirmResultDTO> {
    return this.consent.confirm(token);
  }
}
