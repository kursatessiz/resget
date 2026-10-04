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
  /** The platform tenant (docs/PAZARLAMA.md): only usable while marketing_platform is on, never for roles or money. */
  isPlatform: boolean;
}

/** Present when the request authenticated with a restaurant API key instead of a session (docs/API_ERISIMI.md). */
export interface ApiKeyContext {
  id: string;
  keyId: string;
  restaurantId: string;
  permissions: Set<PermissionKey>;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  tenant?: TenantContext;
  apiKey?: ApiKeyContext;
}
