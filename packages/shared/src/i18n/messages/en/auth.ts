import type { trAuth } from '../tr/auth';

export const enAuth: Record<keyof typeof trAuth, string> = {
  'auth.phone.label': 'Phone number',
  'auth.phone.help': 'We will text you a one-time code.',
  'auth.otp.send': 'Send code',
  'auth.otp.label': 'Verification code',
  'auth.otp.verify': 'Verify and sign in',
  'auth.otp.resend': 'Resend code',
  'auth.otp.sent': 'Code sent. It arrives within a few seconds.',
  'auth.otp.invalid': 'The code is wrong or has expired.',
  'auth.otp.tooMany': 'Too many attempts. Please try again in a little while.',
  'auth.consent.required': 'Accept the terms of service and the privacy notice to continue.',
  'auth.noMembership': 'No restaurant is linked to this number. Use your invite link.',
};
