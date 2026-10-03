import { Controller, Post, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import { RestaurantSignupSchema } from '@resget/shared';
import type { RestaurantCreatedDTO } from '@resget/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/tenant-context';
import { RestaurantProvisioningService } from './provisioning.service';

/** Self sign-up: the signed-in phone becomes the owner of a new restaurant (docs/PLATFORM_YONETIMI.md). */
@Controller('restaurants')
@UseGuards(JwtAuthGuard)
export class RestaurantSignupController {
  constructor(private readonly provisioning: RestaurantProvisioningService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @ZodBody(RestaurantSignupSchema) body: z.infer<typeof RestaurantSignupSchema>,
  ): Promise<RestaurantCreatedDTO> {
    return this.provisioning.create(user.id, body, user.id);
  }
}
