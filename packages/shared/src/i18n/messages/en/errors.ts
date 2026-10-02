import type { trErrors } from '../tr/errors';

export const enErrors: Record<keyof typeof trErrors, string> = {
  'errors.VALIDATION': 'The submitted data is invalid.',
  'errors.UNAUTHORIZED': 'Your session has ended. Please sign in again.',
  'errors.FORBIDDEN': 'You do not have permission to do this.',
  'errors.NOT_FOUND': 'Record not found.',
  'errors.RESTAURANT_INACTIVE': 'This restaurant is not active right now.',
  'errors.MEMBERSHIP_NOT_ACTIVE': 'Your membership in this restaurant is not active.',
  'errors.PLAN_FEATURE_REQUIRED': 'This feature is part of the Pro plan.',
  'errors.INSUFFICIENT_CREDITS': 'Not enough message credits. Buy a credit package.',
  'errors.TABLE_NOT_FOUND': 'This table could not be found. Please ask the staff.',
  'errors.MENU_UNAVAILABLE': 'The menu cannot be shown right now.',
  'errors.COURIER_QUOTE_FAILED': 'Could not get a courier quote. Please try again.',
  'errors.RATE_LIMITED': 'Too many requests. Please wait a moment.',
};
