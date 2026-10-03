import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthUser } from '../tenant-context';

/**
 * Public routes that behave better for a signed-in person (the storefront
 * spending loyalty points): a valid bearer token attaches the user, no token
 * or a stale one leaves the request anonymous instead of rejecting it.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<TUser = AuthUser | null>(_err: unknown, user: AuthUser | false | null | undefined): TUser {
    return (user || null) as TUser;
  }
}
