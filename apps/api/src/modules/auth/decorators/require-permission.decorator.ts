import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import type { PermissionKey, PlanFeature } from '@resget/shared';
import { ApiKeyOrJwtAuthGuard } from '../guards/api-key-or-jwt-auth.guard';
import { RestaurantTenantGuard } from '../guards/restaurant-tenant.guard';
import { PermissionGuard } from '../guards/permission.guard';

export const PERMISSIONS_KEY = 'requiredPermissions';
export const PLAN_FEATURE_KEY = 'requiredPlanFeature';
export const SESSION_ONLY_KEY = 'sessionOnly';

/** Caller needs every listed permission in the current restaurant. */
export const RequirePermission = (...permissions: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** The restaurant's effective plan must include this feature (PRO-only screens such as campaigns). */
export const RequirePlanFeature = (feature: PlanFeature) => SetMetadata(PLAN_FEATURE_KEY, feature);

/** The handler refuses restaurant API keys: a person at the panel is required (keys, staff, roles, billing). */
export const SessionOnly = () => SetMetadata(SESSION_ONLY_KEY, true);

/** Session or API key + tenant resolution + permission and plan check, in that order. */
export const RestaurantScoped = () =>
  applyDecorators(UseGuards(ApiKeyOrJwtAuthGuard, RestaurantTenantGuard, PermissionGuard));
