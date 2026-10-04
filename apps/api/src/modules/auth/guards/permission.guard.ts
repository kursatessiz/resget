import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLAN_FEATURE_SETS } from '@resget/shared';
import type { FeatureKey, PermissionKey, PlanFeature } from '@resget/shared';
import { forbidden } from '../../../common/api-error';
import { FeatureFlagsService } from '../../features/feature-flags.service';
import { FEATURE_KEY, PERMISSIONS_KEY, PLAN_FEATURE_KEY } from '../decorators/require-permission.decorator';
import type { AuthenticatedRequest } from '../tenant-context';

/**
 * Deny by default: a @RestaurantScoped() handler without @RequirePermission
 * is a mistake and is refused. Then every listed permission must be in the
 * caller's effective set, the restaurant's plan must include the
 * handler's plan feature when one is declared, and the handler's module
 * must be switched on for the restaurant (docs/OZELLIK_ANAHTARLARI.md).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenant = request.tenant;
    if (!tenant) throw forbidden('FORBIDDEN', 'Tenant not resolved');
    const targets = [context.getHandler(), context.getClass()];

    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(PERMISSIONS_KEY, targets);
    if (!required || required.length === 0) throw forbidden('FORBIDDEN', 'Handler declares no permission');
    for (const permission of required) {
      if (!tenant.permissions.has(permission)) throw forbidden('FORBIDDEN', `Missing permission ${permission}`);
    }

    const feature = this.reflector.getAllAndOverride<PlanFeature | undefined>(PLAN_FEATURE_KEY, targets);
    if (feature && !PLAN_FEATURE_SETS[tenant.effectivePlan].includes(feature)) {
      throw forbidden('PLAN_FEATURE_REQUIRED', `Feature ${feature} needs a higher plan`);
    }

    const module = this.reflector.getAllAndOverride<FeatureKey | undefined>(FEATURE_KEY, targets);
    if (module) await this.features.assertEnabled(module, tenant.restaurantId);
    // A restaurant API key works only while API access is switched on for its restaurant.
    if (request.apiKey) await this.features.assertEnabled('api_access', tenant.restaurantId);
    return true;
  }
}
