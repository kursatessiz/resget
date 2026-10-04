import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * API errors carry a machine-readable `code` in the body and in the
 * x-error-code header (ErrorCodeFilter). Clients translate `errors.<code>`;
 * the English `message` is for logs and API consumers, never shown to users.
 */
export type ApiErrorCode =
  | 'PAYOUT_NOT_FOUND'
  | 'PAYOUT_STATE_INVALID'
  | 'ADDRESS_NOT_FOUND'
  | 'LISTING_NOT_READY'
  | 'ALREADY_LISTED'
  | 'CAMPAIGN_NOT_FOUND'
  | 'CAMPAIGN_STATE_INVALID'
  | 'SEGMENT_NOT_FOUND'
  | 'DOMAIN_INVALID'
  | 'DOMAIN_TAKEN'
  | 'DOMAIN_NOT_SET'
  | 'API_KEY_NOT_FOUND'
  | 'WEBHOOK_NOT_FOUND'
  | 'WEBHOOK_URL_INVALID'
  | 'MENU_IMPORT_INVALID'
  | 'RATING_NOT_ALLOWED'
  | 'RATING_EXISTS'
  | 'SEGMENT_NAME_TAKEN'
  | 'LOYALTY_NOT_ACTIVE'
  | 'LOYALTY_NOT_REDEEMABLE'
  | 'LOYALTY_SIGN_IN_REQUIRED'
  | 'LOYALTY_PHONE_MISMATCH'
  | 'LOYALTY_INSUFFICIENT_POINTS'
  | 'UNSUPPORTED_FILE'
  | 'FILE_TOO_LARGE'
  | 'CUSTOMER_NOT_FOUND'
  | 'COURIER_PROVIDER_NOT_FOUND'
  | 'INVOICE_NOT_FOUND'
  | 'INVOICE_STATE_INVALID'
  | 'BILLING_CARD_REQUIRED'
  | 'COLLECTION_FAILED'
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
  | 'PAYMENT_CONNECTION_REQUIRED'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_TRANSITION_INVALID'
  | 'ORDER_IN_TRIP'
  | 'ORDER_NOT_DISPATCHABLE'
  | 'TRIP_NOT_FOUND'
  | 'TRIP_STATE_INVALID'
  | 'TRIP_STOP_INVALID'
  | 'TRIP_TOO_MANY_STOPS'
  | 'COURIER_NOT_ASSIGNED'
  | 'COURIER_INVALID'
  | 'MENU_ITEM_UNAVAILABLE'
  | 'PAYMENT_METHOD_NOT_ACCEPTED'
  | 'PAYMENT_STATE_INVALID'
  | 'REFUND_NOT_ALLOWED'
  | 'ACCOUNT_DELETE_OWNER'
  | 'ACCOUNT_DELETE_SUPER_ADMIN'
  | 'ACCOUNT_DELETE_ACTIVE_ORDERS'
  | 'ACCOUNT_DELETE_ACTIVE_TRIP'
  | 'REFUND_IN_PROGRESS'
  | 'REFUND_DECLINED'
  | 'REFUND_PROVIDER_ERROR'
  | 'REFUND_UNAVAILABLE'
  | 'MEAL_CARD_PROVIDER_UNAVAILABLE'
  | 'WEBHOOK_INVALID'
  | 'MENU_CATEGORY_NOT_FOUND'
  | 'MENU_ITEM_NOT_FOUND'
  | 'MENU_CATEGORY_NOT_EMPTY'
  | 'MENU_ITEM_IN_USE'
  | 'REORDER_MISMATCH'
  | 'INVITE_NOT_FOUND'
  | 'INVITE_EXPIRED'
  | 'INVITE_USED'
  | 'INVITE_PHONE_MISMATCH'
  | 'ROLE_PROTECTED'
  | 'ROLE_IN_USE'
  | 'ROLE_NAME_TAKEN'
  | 'STAFF_OWNER_PROTECTED'
  | 'STAFF_ALREADY_MEMBER'
  | 'PACKAGE_NOT_FOUND'
  | 'PAYMENT_METHOD_NOT_FOUND'
  | 'SLUG_TAKEN'
  | 'SERVICE_AREA_EXISTS'
  | 'PLAN_NOT_FOUND'
  | 'RESTAURANT_NOT_FOUND'
  | 'RATE_LIMITED';

export function forbidden(code: ApiErrorCode, message: string): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, code, message });
}

export function notFound(code: ApiErrorCode, message: string): NotFoundException {
  return new NotFoundException({ statusCode: 404, code, message });
}

/** The request is well formed but the entity's current state refuses it (409). */
export function conflict(code: ApiErrorCode, message: string): ConflictException {
  return new ConflictException({ statusCode: 409, code, message });
}

export function badRequest(code: ApiErrorCode, message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, code, message });
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
