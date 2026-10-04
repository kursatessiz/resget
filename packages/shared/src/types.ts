import type { FeatureKey } from './features';
import type { MembershipStatus } from './enums';
import type { PermissionKey } from './permissions';
import type { PlanCode } from './plans';

/** Claims carried in the access token. Users are global and identified by phone. */
export interface AccessTokenClaims {
  sub: string;
  phone: string;
  isSuperAdmin: boolean;
  type: 'access' | 'refresh';
}

export interface AuthUserDTO {
  id: string;
  phone: string;
  fullName: string;
  locale: string | null;
  isSuperAdmin: boolean;
}

export interface MembershipSummaryDTO {
  membershipId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  /** String form so Prisma's generated enum and the shared enum stay assignable. */
  status: `${MembershipStatus}`;
  isOwner: boolean;
  roleName: string;
  permissions: PermissionKey[];
  effectivePlan: PlanCode;
  /** Modules switched on for this restaurant (docs/OZELLIK_ANAHTARLARI.md); screens and tabs hide the others. */
  features: FeatureKey[];
  /** Brand of the restaurant, so the panel shell renders in its color without another call. */
  themePrimary: string;
  logoUrl: string | null;
}

/** GET /auth/me */
export interface MeDTO {
  user: AuthUserDTO;
  memberships: MembershipSummaryDTO[];
}

export interface TokenPairDTO {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

/** Correlation id header echoed on every response. */
export const REQUEST_ID_HEADER = 'x-request-id';
/** Machine readable error code header the API sets next to a 4xx body. */
export const ERROR_CODE_HEADER = 'x-error-code';
