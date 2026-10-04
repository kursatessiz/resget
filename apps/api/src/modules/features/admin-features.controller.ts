import { Controller, Get, HttpCode, Put } from '@nestjs/common';
import type { z } from 'zod';
import { FeatureKeySchema, FeatureSwitchSchema, UuidSchema } from '@resget/shared';
import type { AdminFeatureDTO, FeatureKey, RestaurantFeatureDTO } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../../common/api-error';
import { FeatureFlagsService } from './feature-flags.service';

/** The platform owner switches modules on and off, globally or per restaurant (docs/OZELLIK_ANAHTARLARI.md). */
@Controller('admin')
@SuperAdminOnly()
export class AdminFeaturesController {
  constructor(
    private readonly features: FeatureFlagsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('features')
  list(): Promise<AdminFeatureDTO[]> {
    return this.features.adminList();
  }

  /** The global switch: on, off, or null to follow the catalogue default. */
  @Put('features/:key')
  @HttpCode(200)
  async setGlobal(
    @CurrentUser() user: AuthUser,
    @ZodParam('key', FeatureKeySchema) key: FeatureKey,
    @ZodBody(FeatureSwitchSchema) body: z.infer<typeof FeatureSwitchSchema>,
  ): Promise<AdminFeatureDTO[]> {
    await this.features.set(key, null, body.enabled);
    await this.prisma.auditLog.create({
      data: { actorUserId: user.id, action: 'feature.global_set', entity: 'FeatureFlag', entityId: key, meta: body },
    });
    return this.features.adminList();
  }

  @Get('restaurants/:restaurantId/features')
  async restaurant(@ZodParam('restaurantId', UuidSchema) restaurantId: string): Promise<RestaurantFeatureDTO[]> {
    await this.assertRestaurant(restaurantId);
    return this.features.restaurantList(restaurantId);
  }

  /** A restaurant's own switch, which wins over the global one; null follows the global switch again. */
  @Put('restaurants/:restaurantId/features/:key')
  @HttpCode(200)
  async setRestaurant(
    @CurrentUser() user: AuthUser,
    @ZodParam('restaurantId', UuidSchema) restaurantId: string,
    @ZodParam('key', FeatureKeySchema) key: FeatureKey,
    @ZodBody(FeatureSwitchSchema) body: z.infer<typeof FeatureSwitchSchema>,
  ): Promise<RestaurantFeatureDTO[]> {
    await this.assertRestaurant(restaurantId);
    await this.features.set(key, restaurantId, body.enabled);
    await this.prisma.auditLog.create({
      data: {
        restaurantId,
        actorUserId: user.id,
        action: 'feature.restaurant_set',
        entity: 'FeatureFlag',
        entityId: key,
        meta: body,
      },
    });
    return this.features.restaurantList(restaurantId);
  }

  private async assertRestaurant(restaurantId: string): Promise<void> {
    const found = await this.prisma.restaurant.count({ where: { id: restaurantId } });
    if (!found) throw notFound('RESTAURANT_NOT_FOUND', 'Restaurant not found');
  }
}
