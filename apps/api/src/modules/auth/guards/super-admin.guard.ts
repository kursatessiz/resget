import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { forbidden } from '../../../common/api-error';
import type { AuthenticatedRequest } from '../tenant-context';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user?.isSuperAdmin) throw forbidden('FORBIDDEN', 'Super admin only');
    return true;
  }
}
