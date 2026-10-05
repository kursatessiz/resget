import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ALL_PERMISSIONS,
  PLATFORM_FORBIDDEN_TENANT_PERMISSIONS,
  UuidSchema,
  effectivePermissions,
} from '@resget/shared';
import type { PermissionKey } from '@resget/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementsService, subscriptionForPlanSelect, subscriptionLike } from '../../features/entitlements.service';
import { forbidden } from '../../../common/api-error';
import type { AuthenticatedRequest, TenantContext } from '../tenant-context';
import { SESSION_ONLY_KEY } from '../decorators/require-permission.decorator';

/**
 * Resolves the restaurant a request acts on and the caller's rights in it.
 * The restaurant id comes from the route (`:restaurantId`), the
 * `x-restaurant-id` header or the body; when more than one names a
 * restaurant they must agree, so a body can never redirect a write to
 * another tenant. Super admins get full rights without a membership.
 */
@Injectable()
export class RestaurantTenantGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly plans: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw forbidden('FORBIDDEN', 'Missing user');
    if (request.apiKey) {
      const sessionOnly = this.reflector.getAllAndOverride<boolean | undefined>(SESSION_ONLY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (sessionOnly) throw forbidden('FORBIDDEN', 'This endpoint needs a signed-in person, not an API key');
    }

    const restaurantId = this.resolveRestaurantId(request);
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        isActive: true,
        isPlatform: true,
        subscription: { select: subscriptionForPlanSelect },
      },
    });
    if (!restaurant) throw forbidden('FORBIDDEN', 'No access to this restaurant');
    if (!restaurant.isActive && !user.isSuperAdmin) throw forbidden('RESTAURANT_INACTIVE', 'Restaurant is inactive');

    // The plan in force and what it carries, with the restaurant's grants (docs/PLAN_MATRISI.md).
    const resolved = await this.plans.resolveFor(restaurantId, subscriptionLike(restaurant.subscription));
    const plan = {
      effectivePlan: resolved.planCode,
      planName: resolved.planName,
      entitlements: resolved.entitlements,
    };

    // An API key is its own membership: bound to one restaurant, holding the permissions it was minted with,
    // and worth nothing once the plan no longer carries API access (docs/API_ERISIMI.md).
    if (request.apiKey) {
      if (request.apiKey.restaurantId !== restaurantId)
        throw forbidden('FORBIDDEN', 'Key belongs to another restaurant');
      if (!resolved.entitlements.has('api_access'))
        throw forbidden('PLAN_FEATURE_REQUIRED', 'API access is not in the restaurant plan');
      request.tenant = {
        restaurantId,
        membershipId: null,
        isOwner: false,
        isSuperAdmin: false,
        permissions: this.scoped(new Set(request.apiKey.permissions), restaurant.isPlatform),
        ...plan,
        isPlatform: restaurant.isPlatform,
      };
      return true;
    }

    if (user.isSuperAdmin) {
      request.tenant = {
        restaurantId,
        membershipId: null,
        isOwner: !restaurant.isPlatform,
        isSuperAdmin: true,
        permissions: this.scoped(new Set(ALL_PERMISSIONS), restaurant.isPlatform),
        ...plan,
        isPlatform: restaurant.isPlatform,
      };
      return true;
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_restaurantId: { userId: user.id, restaurantId } },
      select: {
        id: true,
        status: true,
        roleTemplate: { select: { isOwner: true, permissions: { select: { permissionKey: true } } } },
      },
    });
    if (!membership) throw forbidden('FORBIDDEN', 'No access to this restaurant');
    if (membership.status !== 'ACTIVE') throw forbidden('MEMBERSHIP_NOT_ACTIVE', 'Membership is not active');

    const tenant: TenantContext = {
      restaurantId,
      membershipId: membership.id,
      isOwner: membership.roleTemplate.isOwner,
      isSuperAdmin: false,
      permissions: this.scoped(
        effectivePermissions(
          membership.roleTemplate.isOwner,
          membership.roleTemplate.permissions.map((p) => p.permissionKey),
        ),
        restaurant.isPlatform,
      ),
      ...plan,
      isPlatform: restaurant.isPlatform,
    };
    request.tenant = tenant;
    return true;
  }

  /**
   * On the platform tenant (docs/PAZARLAMA.md) roles, staff, settings and money are out of reach for
   * everyone, the super admin included: platform users are managed from the console only.
   */
  private scoped(permissions: Set<PermissionKey>, isPlatform: boolean): Set<PermissionKey> {
    if (!isPlatform) return permissions;
    for (const key of PLATFORM_FORBIDDEN_TENANT_PERMISSIONS) permissions.delete(key);
    return permissions;
  }

  private resolveRestaurantId(request: AuthenticatedRequest): string {
    const candidates: unknown[] = [
      request.params?.restaurantId,
      request.headers['x-restaurant-id'],
      request.query?.restaurantId,
    ];
    const body = request.body as unknown;
    if (body && typeof body === 'object' && 'restaurantId' in body)
      candidates.push((body as { restaurantId: unknown }).restaurantId);

    const ids = new Set<string>();
    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null) continue;
      const parsed = UuidSchema.safeParse(candidate);
      if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION', message: 'Invalid restaurantId' });
      ids.add(parsed.data);
    }
    if (ids.size === 0) throw new BadRequestException({ code: 'VALIDATION', message: 'restaurantId is required' });
    if (ids.size > 1) throw forbidden('FORBIDDEN', 'Conflicting restaurant ids in the request');
    return [...ids][0];
  }
}
