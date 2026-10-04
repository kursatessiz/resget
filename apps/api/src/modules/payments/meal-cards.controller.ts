import { Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import { z } from 'zod';
import { MealCardProviderCodeSchema, UpsertMealCardConnectionSchema } from '@resget/shared';
import type { MealCardProviderCode, MealCardSettingsDTO } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { RequireFeature, RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { MealCardsService } from './meal-cards.service';

/** Which meal cards the restaurant takes, at the door and online (docs/YEMEK_KARTI.md). */
@Controller('restaurants/:restaurantId/payments/meal-cards')
@RestaurantScoped()
@RequireFeature('meal_cards')
export class MealCardsController {
  constructor(private readonly mealCards: MealCardsService) {}

  @Get()
  @RequirePermission('payments.manage')
  settings(@Tenant() tenant: TenantContext): Promise<MealCardSettingsDTO> {
    return this.mealCards.settings(tenant.restaurantId);
  }

  /** Credentials go in once and come back only as a masked label. */
  @Put()
  @RequirePermission('payments.manage')
  upsert(
    @Tenant() tenant: TenantContext,
    @ZodBody(UpsertMealCardConnectionSchema) body: z.infer<typeof UpsertMealCardConnectionSchema>,
  ): Promise<MealCardSettingsDTO> {
    return this.mealCards.upsert(tenant.restaurantId, body);
  }

  @Delete(':providerCode')
  @HttpCode(200)
  @RequirePermission('payments.manage')
  remove(
    @Tenant() tenant: TenantContext,
    @ZodParam('providerCode', MealCardProviderCodeSchema) providerCode: MealCardProviderCode,
  ): Promise<MealCardSettingsDTO> {
    return this.mealCards.remove(tenant.restaurantId, providerCode);
  }
}
