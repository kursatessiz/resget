import { ExecutionContext, InternalServerErrorException, createParamDecorator } from '@nestjs/common';
import type { AuthUser, AuthenticatedRequest, TenantContext } from '../tenant-context';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new InternalServerErrorException('CurrentUser used without JwtAuthGuard');
  return user;
});

/** The resolved tenant of a @RestaurantScoped() route. */
export const Tenant = createParamDecorator((_data: unknown, ctx: ExecutionContext): TenantContext => {
  const tenant = ctx.switchToHttp().getRequest<AuthenticatedRequest>().tenant;
  if (!tenant) throw new InternalServerErrorException('Tenant used without RestaurantTenantGuard');
  return tenant;
});
