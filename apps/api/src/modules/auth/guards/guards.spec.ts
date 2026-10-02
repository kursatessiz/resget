import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALL_PERMISSIONS } from '@resget/shared';
import type { PermissionKey } from '@resget/shared';
import { RestaurantTenantGuard } from './restaurant-tenant.guard';
import { PermissionGuard } from './permission.guard';
import { PERMISSIONS_KEY, PLAN_FEATURE_KEY } from '../decorators/require-permission.decorator';
import type { AuthUser, AuthenticatedRequest, TenantContext } from '../tenant-context';

const RESTAURANT_A = '11111111-1111-4111-8111-111111111111';
const RESTAURANT_B = '22222222-2222-4222-8222-222222222222';
const user: AuthUser = { id: 'u1', phone: '+905321112233', fullName: 'A B', isSuperAdmin: false };

function ctx(
  request: Partial<AuthenticatedRequest>,
  meta: { permissions?: PermissionKey[]; feature?: string } = {},
): ExecutionContext {
  const req = Object.assign(request, {
    params: request.params ?? {},
    query: request.query ?? {},
    headers: request.headers ?? {},
  });
  const handler = () => undefined;
  if (meta.permissions) Reflect.defineMetadata(PERMISSIONS_KEY, meta.permissions, handler);
  if (meta.feature) Reflect.defineMetadata(PLAN_FEATURE_KEY, meta.feature, handler);
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function restaurantRow(overrides: Record<string, unknown> = {}) {
  return {
    isActive: true,
    subscription: {
      plan: { code: 'PRO' },
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() + 86400000),
      currentPeriodEnd: null,
    },
    ...overrides,
  };
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    status: 'ACTIVE',
    roleTemplate: { isOwner: false, permissions: [{ permissionKey: 'orders.view' }, { permissionKey: 'unknown.key' }] },
    ...overrides,
  };
}

describe('RestaurantTenantGuard', () => {
  const prisma = { restaurant: { findUnique: jest.fn() }, membership: { findUnique: jest.fn() } };
  const guard = new RestaurantTenantGuard(prisma as never);

  beforeEach(() => jest.resetAllMocks());

  it('resolves the tenant, effective permissions and plan from the membership', async () => {
    prisma.restaurant.findUnique.mockResolvedValue(restaurantRow());
    prisma.membership.findUnique.mockResolvedValue(membershipRow());
    const request: Partial<AuthenticatedRequest> = { user, params: { restaurantId: RESTAURANT_A } };
    await expect(guard.canActivate(ctx(request))).resolves.toBe(true);
    expect(request.tenant?.restaurantId).toBe(RESTAURANT_A);
    expect([...(request.tenant?.permissions ?? [])]).toEqual(['orders.view']);
    expect(request.tenant?.effectivePlan).toBe('PRO');
  });

  it('a lapsed trial resolves to BASIC', async () => {
    prisma.restaurant.findUnique.mockResolvedValue(
      restaurantRow({
        subscription: {
          plan: { code: 'PRO' },
          status: 'TRIALING',
          trialEndsAt: new Date(Date.now() - 1000),
          currentPeriodEnd: null,
        },
      }),
    );
    prisma.membership.findUnique.mockResolvedValue(membershipRow());
    const request: Partial<AuthenticatedRequest> = { user, headers: { 'x-restaurant-id': RESTAURANT_A } };
    await guard.canActivate(ctx(request));
    expect(request.tenant?.effectivePlan).toBe('BASIC');
  });

  it('owners hold every permission', async () => {
    prisma.restaurant.findUnique.mockResolvedValue(restaurantRow());
    prisma.membership.findUnique.mockResolvedValue(membershipRow({ roleTemplate: { isOwner: true, permissions: [] } }));
    const request: Partial<AuthenticatedRequest> = { user, params: { restaurantId: RESTAURANT_A } };
    await guard.canActivate(ctx(request));
    expect(request.tenant?.permissions.size).toBe(ALL_PERMISSIONS.length);
  });

  it('super admins need no membership', async () => {
    prisma.restaurant.findUnique.mockResolvedValue(restaurantRow({ isActive: false }));
    const request: Partial<AuthenticatedRequest> = {
      user: { ...user, isSuperAdmin: true },
      params: { restaurantId: RESTAURANT_A },
    };
    await expect(guard.canActivate(ctx(request))).resolves.toBe(true);
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
    expect(request.tenant?.isSuperAdmin).toBe(true);
  });

  it('rejects users without a membership, inactive memberships and inactive restaurants', async () => {
    prisma.restaurant.findUnique.mockResolvedValue(restaurantRow());
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(ctx({ user, params: { restaurantId: RESTAURANT_B } }))).rejects.toThrow(
      ForbiddenException,
    );
    prisma.membership.findUnique.mockResolvedValue(membershipRow({ status: 'INVITED' }));
    await expect(guard.canActivate(ctx({ user, params: { restaurantId: RESTAURANT_A } }))).rejects.toThrow(
      ForbiddenException,
    );
    prisma.restaurant.findUnique.mockResolvedValue(restaurantRow({ isActive: false }));
    await expect(guard.canActivate(ctx({ user, params: { restaurantId: RESTAURANT_A } }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a body restaurantId that differs from the route, and non-uuid ids', async () => {
    await expect(
      guard.canActivate(ctx({ user, params: { restaurantId: RESTAURANT_A }, body: { restaurantId: RESTAURANT_B } })),
    ).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx({ user, body: { restaurantId: { $ne: null } } }))).rejects.toThrow(
      BadRequestException,
    );
    await expect(guard.canActivate(ctx({ user }))).rejects.toThrow(BadRequestException);
    expect(prisma.restaurant.findUnique).not.toHaveBeenCalled();
  });
});

describe('PermissionGuard', () => {
  const guard = new PermissionGuard(new Reflector());
  const tenant = (overrides: Partial<TenantContext> = {}): TenantContext => ({
    restaurantId: RESTAURANT_A,
    membershipId: 'm1',
    isOwner: false,
    isSuperAdmin: false,
    permissions: new Set<PermissionKey>(['orders.view']),
    effectivePlan: 'BASIC',
    ...overrides,
  });

  it('refuses a handler that declares no permission (deny by default)', () => {
    expect(() => guard.canActivate(ctx({ user, tenant: tenant() }))).toThrow(ForbiddenException);
  });

  it('checks every required permission', () => {
    expect(guard.canActivate(ctx({ user, tenant: tenant() }, { permissions: ['orders.view'] }))).toBe(true);
    expect(() =>
      guard.canActivate(ctx({ user, tenant: tenant() }, { permissions: ['orders.view', 'orders.manage'] })),
    ).toThrow(ForbiddenException);
  });

  it('gates PRO features by the effective plan with the PLAN_FEATURE_REQUIRED code', () => {
    const basic = ctx(
      { user, tenant: tenant({ permissions: new Set<PermissionKey>(['campaigns.view']) }) },
      { permissions: ['campaigns.view'], feature: 'campaigns' },
    );
    try {
      guard.canActivate(basic);
      throw new Error('expected ForbiddenException');
    } catch (err) {
      expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'PLAN_FEATURE_REQUIRED' });
    }
    const pro = ctx(
      { user, tenant: tenant({ permissions: new Set<PermissionKey>(['campaigns.view']), effectivePlan: 'PRO' }) },
      { permissions: ['campaigns.view'], feature: 'campaigns' },
    );
    expect(guard.canActivate(pro)).toBe(true);
  });
});
