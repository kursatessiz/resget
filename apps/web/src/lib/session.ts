/**
 * Session cookies of the web app (docs/MIMARI.md "Oturum"). Tokens live in
 * httpOnly cookies only; the BFF turns the access cookie into the bearer
 * header and the middleware refreshes it before it expires. Nothing about
 * the session is readable from browser JavaScript.
 */
export const ACCESS_TOKEN_COOKIE = 'resget_access';
export const REFRESH_TOKEN_COOKIE = 'resget_refresh';
/** Last restaurant the member opened; the switcher's default. */
export const RESTAURANT_COOKIE = 'resget_restaurant';
/** Anonymous table QR session (docs/MASA_QR.md); set by the middleware on the first /m visit. */
export const QR_SESSION_COOKIE = 'resget_qr_session';

export const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const QR_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
/** The access token is refreshed when fewer than this many seconds remain. */
export const ACCESS_REFRESH_SKEW_SECONDS = 60;

export interface CookieOptions {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
}

export function sessionCookieOptions(maxAge: number, secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge };
}

/** Expiry (seconds since epoch) of a JWT without verifying it; the API verifies, this only schedules refreshes. */
export function jwtExpiry(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export function accessTokenNeedsRefresh(
  token: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!token) return true;
  const exp = jwtExpiry(token);
  return exp === null || exp - nowSeconds < ACCESS_REFRESH_SKEW_SECONDS;
}
