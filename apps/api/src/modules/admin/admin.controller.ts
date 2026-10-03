import { Controller, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import {
  AdminCreateRestaurantSchema,
  AdminRestaurantQuerySchema,
  AdminRestaurantUpdateSchema,
  CreateServiceAreaSchema,
  DensityQuerySchema,
  GrantCreditsSchema,
  UpdatePlanSchema,
  UpdateServiceAreaSchema,
  UpsertCreditPackageSchema,
  UuidSchema,
} from '@resget/shared';
import type {
  AdminCreditPackageDTO,
  AdminOverviewDTO,
  AdminRestaurantDTO,
  AdminRestaurantPageDTO,
  GrantCreditsResultDTO,
  PlanDTO,
  RestaurantCreatedDTO,
  ServiceAreaDTO,
  SystemHealthDTO,
} from '@resget/shared';
import { ZodBody, ZodParam, ZodQuery } from '../../common/zod-body.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { AdminService } from './admin.service';
import { SystemHealthService } from './system-health.service';

/** Platform owner only: restaurants, service areas, plans, packages, credits and the density board. */
@Controller('admin')
@SuperAdminOnly()
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly health: SystemHealthService,
  ) {}

  /** Live system page: components, jobs, providers and balances, the last 24 hours. */
  @Get('system')
  system(): Promise<SystemHealthDTO> {
    return this.health.snapshot();
  }

  @Get('overview')
  overview(@ZodQuery(DensityQuerySchema) query: z.infer<typeof DensityQuerySchema>): Promise<AdminOverviewDTO> {
    return this.admin.overview(query.days);
  }

  @Get('restaurants')
  restaurants(
    @ZodQuery(AdminRestaurantQuerySchema) query: z.infer<typeof AdminRestaurantQuerySchema>,
  ): Promise<AdminRestaurantPageDTO> {
    return this.admin.listRestaurants(query);
  }

  @Post('restaurants')
  createRestaurant(
    @CurrentUser() user: AuthUser,
    @ZodBody(AdminCreateRestaurantSchema) body: z.infer<typeof AdminCreateRestaurantSchema>,
  ): Promise<RestaurantCreatedDTO> {
    return this.admin.createRestaurant(user.id, body);
  }

  @Get('restaurants/:id')
  restaurant(@ZodParam('id', UuidSchema) id: string): Promise<AdminRestaurantDTO> {
    return this.admin.getRestaurant(id);
  }

  @Patch('restaurants/:id')
  updateRestaurant(
    @CurrentUser() user: AuthUser,
    @ZodParam('id', UuidSchema) id: string,
    @ZodBody(AdminRestaurantUpdateSchema) body: z.infer<typeof AdminRestaurantUpdateSchema>,
  ): Promise<AdminRestaurantDTO> {
    return this.admin.updateRestaurant(user.id, id, body);
  }

  @Post('restaurants/:id/credits')
  @HttpCode(200)
  grantCredits(
    @CurrentUser() user: AuthUser,
    @ZodParam('id', UuidSchema) id: string,
    @ZodBody(GrantCreditsSchema) body: z.infer<typeof GrantCreditsSchema>,
  ): Promise<GrantCreditsResultDTO> {
    return this.admin.grantCredits(user.id, id, body);
  }

  @Get('service-areas')
  serviceAreas(): Promise<ServiceAreaDTO[]> {
    return this.admin.listServiceAreas();
  }

  @Post('service-areas')
  createServiceArea(
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateServiceAreaSchema) body: z.infer<typeof CreateServiceAreaSchema>,
  ): Promise<ServiceAreaDTO> {
    return this.admin.createServiceArea(user.id, body);
  }

  @Patch('service-areas/:id')
  updateServiceArea(
    @CurrentUser() user: AuthUser,
    @ZodParam('id', UuidSchema) id: string,
    @ZodBody(UpdateServiceAreaSchema) body: z.infer<typeof UpdateServiceAreaSchema>,
  ): Promise<ServiceAreaDTO> {
    return this.admin.setServiceAreaLaunch(user.id, id, body.isLaunched);
  }

  @Get('plans')
  plans(): Promise<PlanDTO[]> {
    return this.admin.listPlans();
  }

  @Patch('plans/:id')
  updatePlan(
    @CurrentUser() user: AuthUser,
    @ZodParam('id', UuidSchema) id: string,
    @ZodBody(UpdatePlanSchema) body: z.infer<typeof UpdatePlanSchema>,
  ): Promise<PlanDTO> {
    return this.admin.updatePlan(user.id, id, body);
  }

  @Get('credit-packages')
  creditPackages(): Promise<AdminCreditPackageDTO[]> {
    return this.admin.listCreditPackages();
  }

  @Put('credit-packages')
  upsertCreditPackage(
    @CurrentUser() user: AuthUser,
    @ZodBody(UpsertCreditPackageSchema) body: z.infer<typeof UpsertCreditPackageSchema>,
  ): Promise<AdminCreditPackageDTO> {
    return this.admin.upsertCreditPackage(user.id, body);
  }
}
