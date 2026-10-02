import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ALL_PERMISSIONS, UuidSchema, effectivePermissions, effectivePlan } from '@resget/shared';
import type { PlanCode, SubscriptionStatus as SharedSubscriptionStatus } from '@resget/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { forbidden } from '../../../common/api-error';
import type { AuthenticatedRequest, TenantContext } from '../tenant-context';

/**
 * Resolves the restaurant a request acts on and the caller's rights in it.
 * The restaurant id comes from the route (`:restaurantId`), the
 * `x-restaurant-id` header or the body; when more than one names a
 * restaurant they must agree, so a body can never redirect a write to
 * another tenant. Super admins get full rights without a membership.
 */
@Injectable()
export class RestaurantTenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw forbidden('FORBIDDEN', 'Missing user');

    const restaurantId = this.resolveRestaurantId(request);
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        isActive: true,
        subscription: {
          select: { plan: { select: { code: true } }, status: true, trialEndsAt: true, currentPeriodEnd: true },
        },
      },
    });
    if (!restaurant) throw forbidden('FORBIDDEN', 'No access to this restaurant');
    if (!restaurant.isActive && !user.isSuperAdmin) throw forbidden('RESTAURANT_INACTIVE', 'Restaurant is inactive');

    const subscription = restaurant.subscription;
    const plan: PlanCode = effectivePlan(
      subscription
        ? {
            planCode: subscription.plan.code === 'PRO' ? 'PRO' : 'BASIC',
            status: subscription.status as unknown as SharedSubscriptionStatus,
            trialEndsAt: subscription.trialEndsAt,
            currentPeriodEnd: subscription.currentPeriodEnd,
          }
        : null,
    );

    if (user.isSuperAdmin) {
      request.tenant = {
        restaurantId,
        membershipId: null,
        isOwner: true,
        isSuperAdmin: true,
        permissions: new Set(ALL_PERMISSIONS),
        effectivePlan: plan,
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
      permissions: effectivePermissions(
        membership.roleTemplate.isOwner,
        membership.roleTemplate.permissions.map((p) => p.permissionKey),
      ),
      effectivePlan: plan,
    };
    request.tenant = tenant;
    return true;
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
