import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/tenant-context';
import { notFound } from '../../common/api-error';

@Controller('restaurants/:restaurantId')
@RestaurantScoped()
export class RestaurantsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('restaurant.settings.view')
  async get(@Tenant() tenant: TenantContext) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: tenant.restaurantId },
      select: {
        id: true,
        slug: true,
        name: true,
        countryCode: true,
        currency: true,
        timezone: true,
        defaultLocale: true,
        isListed: true,
        commissionBps: true,
        pspPercentBps: true,
        pspFixedMinor: true,
        deliveryMode: true,
        deliveryFeePolicy: true,
        logoUrl: true,
        themePrimary: true,
        branches: {
          where: { isActive: true },
          select: { id: true, name: true, city: true, district: true },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    return { ...restaurant, effectivePlan: tenant.effectivePlan, permissions: [...tenant.permissions] };
  }
}
