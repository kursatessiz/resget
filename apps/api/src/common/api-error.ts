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
  | 'NPS_EXISTS'
  | 'CAMPAIGN_APPROVAL_REQUIRED'
  | 'APPROVAL_SELF_FORBIDDEN'
  | 'SEND_LIMIT_EXCEEDED'
  | 'NPS_NOT_ALLOWED'
  | 'FEEDBACK_CASE_NOT_FOUND'
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
  | 'MENU_ITEM_SOLD_OUT'
  | 'GROUP_CART_NOT_FOUND'
  | 'GROUP_CART_CLOSED'
  | 'GROUP_CART_FULL'
  | 'GROUP_CART_EMPTY'
  | 'GROUP_CART_FORBIDDEN'
  | 'MODIFIER_INVALID'
  | 'MODIFIER_PRICE_CHANGED'
  | 'PAYMENT_METHOD_NOT_ACCEPTED'
  | 'PAYMENT_STATE_INVALID'
  | 'REFUND_NOT_ALLOWED'
  | 'ACCOUNT_DELETE_OWNER'
  | 'OWNERSHIP_TRANSFER_FORBIDDEN'
  | 'OWNERSHIP_TARGET_INVALID'
  | 'ACCOUNT_DELETE_SUPER_ADMIN'
  | 'ACCOUNT_DELETE_ACTIVE_ORDERS'
  | 'ACCOUNT_DELETE_ACTIVE_TRIP'
  | 'REFUND_IN_PROGRESS'
  | 'REFUND_DECLINED'
  | 'REFUND_PROVIDER_ERROR'
  | 'REFUND_UNAVAILABLE'
  | 'REFUND_ITEMS_INVALID'
  | 'REFUND_AMOUNT_TOO_HIGH'
  | 'CLAIM_NOT_ALLOWED'
  | 'FEATURE_DISABLED'
  | 'CLAIM_NOT_FOUND'
  | 'CLAIM_NOT_OPEN'
  | 'CLAIM_ITEMS_INVALID'
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
  | 'PLAN_CODE_TAKEN'
  | 'PLAN_FALLBACK_LOCKED'
  | 'ENTITLEMENT_NOT_FOUND'
  | 'TAB_NOT_FOUND'
  | 'TAB_CLOSED'
  | 'TAB_NOT_SETTLED'
  | 'REVIEW_NOT_FOUND'
  | 'REVIEW_EDIT_CLOSED'
  | 'REVIEW_ALREADY_REPORTED'
  | 'RESTAURANT_NOT_FOUND'
  | 'RESTAURANT_NOT_ACCEPTING'
  | 'DELIVERY_OUT_OF_ZONE'
  | 'MIN_BASKET_NOT_MET'
  | 'COUPON_NOT_FOUND'
  | 'COUPON_EXPIRED'
  | 'COUPON_MIN_BASKET'
  | 'COUPON_FIRST_ORDER_ONLY'
  | 'COUPON_LIMIT_REACHED'
  | 'COUPON_ALREADY_USED'
  | 'COUPON_OWN_REFERRAL'
  | 'REFERRAL_NOT_AVAILABLE'
  | 'COUPON_PHONE_REQUIRED'
  | 'COUPON_NOT_COMBINABLE'
  | 'COUPON_CODE_TAKEN'
  | 'COUPON_IN_USE'
  | 'PLATFORM_NOT_SET_UP'
  | 'PLATFORM_ACCESS_DENIED'
  | 'PLANS_MISSING'
  | 'CONTACT_EXISTS'
  | 'EMAIL_DOMAIN_RESERVED'
  | 'EMAIL_DOMAIN_TAKEN'
  | 'SUPPRESSION_LOCKED'
  | 'SEGMENT_NOT_STATIC'
  | 'SEGMENT_IN_USE'
  | 'CAMPAIGN_CONTENT_INVALID'
  | 'EMAIL_DOMAIN_NOT_VERIFIED'
  | 'JOURNEY_NOT_FOUND'
  | 'JOURNEY_CONTENT_INVALID'
  | 'AD_CREDENTIALS_INVALID'
  | 'AD_CREDENTIALS_REFUSED'
  | 'AD_CONNECTION_NOT_FOUND'
  | 'SITE_PAGE_NOT_FOUND'
  | 'SITE_PAGE_PATH_TAKEN'
  | 'PLATFORM_ONLY'
  | 'RATE_LIMITED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_BUDGET_EXHAUSTED'
  | 'AI_REFUSED'
  | 'AI_FAILED'
  | 'SOCIAL_NOT_CONFIGURED'
  | 'SOCIAL_ACCOUNT_NOT_FOUND'
  | 'LEAD_ADS_PAGE_REQUIRED'
  | 'META_SUBSCRIBE_FAILED'
  | 'LEAD_NOT_FOUND'
  | 'LEAD_NOT_RETRYABLE'
  | 'SOCIAL_POST_NOT_FOUND'
  | 'SOCIAL_POST_LOCKED'
  | 'SOCIAL_POST_INVALID'
  | 'SOCIAL_SCHEDULE_INVALID'
  | 'SOCIAL_ACCOUNT_UNAVAILABLE'
  | 'SCHEDULED_SLOT_INVALID'
  | 'SCHEDULING_UNAVAILABLE'
  | 'MENU_ITEM_NOT_SERVED'
  | 'DELIVERY_CODE_REQUIRED'
  | 'DELIVERY_CODE_INVALID'
  | 'DELIVERY_CODE_LOCKED';

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

/** An upstream service (an AI or other provider) failed or answered unusably (502). */
export function badGateway(code: ApiErrorCode, message: string): HttpException {
  return new HttpException({ statusCode: 502, code, message }, 502);
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
