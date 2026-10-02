import { ForbiddenException, HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';

/**
 * API errors carry a machine-readable `code` in the body and in the
 * x-error-code header (ErrorCodeFilter). Clients translate `errors.<code>`;
 * the English `message` is for logs and API consumers, never shown to users.
 */
export type ApiErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RESTAURANT_INACTIVE'
  | 'MEMBERSHIP_NOT_ACTIVE'
  | 'PLAN_FEATURE_REQUIRED'
  | 'INSUFFICIENT_CREDITS'
  | 'TABLE_NOT_FOUND'
  | 'MENU_UNAVAILABLE'
  | 'COURIER_QUOTE_FAILED'
  | 'RATE_LIMITED';

export function forbidden(code: ApiErrorCode, message: string): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, code, message });
}

export function notFound(code: ApiErrorCode, message: string): NotFoundException {
  return new NotFoundException({ statusCode: 404, code, message });
}

export function unauthorized(message = 'Authentication required'): UnauthorizedException {
  return new UnauthorizedException({ statusCode: 401, code: 'UNAUTHORIZED', message });
}

export function errorCodeOf(exception: HttpException): string | null {
  const response = exception.getResponse();
  if (typeof response === 'object' && response !== null && 'code' in response) {
    const code = (response as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}
