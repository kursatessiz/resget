'use client';

import {
  CONSENT_COOKIE,
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE_SECONDS,
  VISIT_SESSION_COOKIE,
  VISIT_SESSION_MAX_AGE_SECONDS,
  VisitorIdSchema,
  decodeConsent,
  encodeConsent,
  hasTrackingParams,
} from '@resget/shared';
import type { ConsentChoice } from '@resget/shared';

/**
 * Browser side of visit measurement (docs/ATIF.md). The visitor and session
 * cookies exist only while analytics consent does; withdrawing it deletes
 * them. The beacon goes through the BFF like every other call.
 */

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return null;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function storedConsent(): ConsentChoice | null {
  return decodeConsent(readCookie(CONSENT_COOKIE));
}

export function globalPrivacyControl(): boolean {
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

export function saveConsent(choice: ConsentChoice): void {
  writeCookie(CONSENT_COOKIE, encodeConsent(choice), CONSENT_COOKIE_MAX_AGE_SECONDS);
  if (!choice.analytics) {
    writeCookie(VISITOR_COOKIE, '', 0);
    writeCookie(VISIT_SESSION_COOKIE, '', 0);
  }
}

/**
 * Sends a touchpoint for the first page of a visit, or for any page whose
 * URL carries tracking parameters. Every page view extends the session.
 */
export async function trackPageView(target: string, consent: ConsentChoice, tableToken: string | null): Promise<void> {
  if (!consent.analytics) return;
  const storedVisitor = readCookie(VISITOR_COOKIE);
  const visitorId = storedVisitor && VisitorIdSchema.safeParse(storedVisitor).success ? storedVisitor : newId();
  writeCookie(VISITOR_COOKIE, visitorId, VISITOR_COOKIE_MAX_AGE_SECONDS);
  const storedSession = readCookie(VISIT_SESSION_COOKIE);
  const newSession = !storedSession || !VisitorIdSchema.safeParse(storedSession).success;
  const sessionId = newSession ? newId() : storedSession;
  writeCookie(VISIT_SESSION_COOKIE, sessionId, VISIT_SESSION_MAX_AGE_SECONDS);
  if (!newSession && !hasTrackingParams(new URLSearchParams(window.location.search))) return;
  await fetch(`/api/bff/public/track/${encodeURIComponent(target)}/touchpoint`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      visitorId,
      sessionId,
      url: window.location.href,
      referrer: document.referrer || null,
      consent,
      locale: navigator.language || null,
      tableToken,
    }),
    keepalive: true,
    cache: 'no-store',
  }).catch(() => undefined);
}
