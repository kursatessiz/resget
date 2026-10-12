import { Controller, Headers, Post, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import { RestaurantSignupSchema, VISITOR_HEADER, hasSettlementDefaults } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/tenant-context';
import { RestaurantProvisioningService } from './provisioning.service';
import { forbidden } from '../../common/api-error';

/** Self sign-up: the signed-in phone becomes the owner of a new restaurant (docs/PLATFORM_YONETIMI.md). */
@Controller('restaurants')
@UseGuards(JwtAuthGuard)
export class RestaurantSignupController {
  constructor(private readonly provisioning: RestaurantProvisioningService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @ZodBody(RestaurantSignupSchema) body: z.infer<typeof RestaurantSignupSchema>,
    @Headers(VISITOR_HEADER) visitorId?: string,
  ): Promise<RestaurantCreatedDTO> {
    // The country selects the tax parameters of every order (docs/MUTABAKAT.md, "Bölgesel varsayılanlar"): self
    // sign-up is open only where the platform has settlement rules; the console opens restaurants elsewhere.
    if (!hasSettlementDefaults(body.countryCode)) {
      throw forbidden('SIGNUP_COUNTRY_NOT_AVAILABLE', 'Self sign-up is not open in this country');
    }
    return this.provisioning.create(user.id, body, user.id, visitorId ?? null, { selfService: !user.isSuperAdmin });
  }
}
