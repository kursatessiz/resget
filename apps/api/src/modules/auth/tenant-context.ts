import type { Request } from 'express';
import type { PermissionKey, PlanCode } from '@resget/shared';

export interface AuthUser {
  id: string;
  phone: string;
  fullName: string;
  isSuperAdmin: boolean;
}

/** Resolved by RestaurantTenantGuard for every @RestaurantScoped() route. */
export interface TenantContext {
  restaurantId: string;
  membershipId: string | null;
  isOwner: boolean;
  isSuperAdmin: boolean;
  permissions: Set<PermissionKey>;
  effectivePlan: PlanCode;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  tenant?: TenantContext;
}
