import { z } from 'zod';
import { stripTrailingSlashes } from './validators';

/**
 * One-time session handoff from the mobile app to the browser
 * (docs/GUVENLIK.md): the app asks for a short-lived code, the browser opens
 * the web's handoff route with it, and the web turns the code into its own
 * httpOnly session cookies before redirecting to a local path.
 */
export const SESSION_HANDOFF_TTL_SECONDS = 60;

/** 32 random bytes in base64url. */
export const SessionHandoffCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const RedeemSessionHandoffSchema = z.object({ code: SessionHandoffCodeSchema }).strict();
export type RedeemSessionHandoffInput = z.infer<typeof RedeemSessionHandoffSchema>;

export interface SessionHandoffDTO {
  code: string;
  expiresAt: string;
}

/** The web route that redeems a handoff code and redirects to `next`. */
export const SESSION_HANDOFF_PATH = '/api/session/handoff';

export function sessionHandoffUrl(webBaseUrl: string, code: string, next: string): string {
  const query = `code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`;
  return `${stripTrailingSlashes(webBaseUrl)}${SESSION_HANDOFF_PATH}?${query}`;
}
