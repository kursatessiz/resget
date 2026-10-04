import { createHash } from 'node:crypto';

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface OutgoingEmail {
  from: string;
  fromName: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

export interface EmailSendResult {
  status: 'SENT' | 'FAILED';
  providerRef: string | null;
  errorCode: string | null;
}

/**
 * The email gateway (docs/EPOSTA.md). Amazon SES is the global default; the
 * MOCK stand-in accepts outside production and refuses in it, so a missing
 * configuration never looks like a delivered email.
 */
export interface EmailProvider {
  readonly code: 'MOCK' | 'SES';
  /** Whether a send can actually reach a mailbox. */
  ready(): boolean;
  send(email: OutgoingEmail): Promise<EmailSendResult>;
  /** Registers a sending domain and returns its Easy DKIM tokens. */
  createIdentity(domain: string): Promise<{ dkimTokens: string[] }>;
  deleteIdentity(domain: string): Promise<void>;
}

/** Test and development stand-in; keeps what it sent so tests can read it. */
export class MockEmailProvider implements EmailProvider {
  readonly code = 'MOCK' as const;
  readonly outbox: OutgoingEmail[] = [];

  constructor(private readonly production: boolean) {}

  ready(): boolean {
    return !this.production;
  }

  async send(email: OutgoingEmail): Promise<EmailSendResult> {
    if (this.production) return { status: 'FAILED', providerRef: null, errorCode: 'EMAIL_NOT_CONFIGURED' };
    this.outbox.push(email);
    if (this.outbox.length > 200) this.outbox.shift();
    return { status: 'SENT', providerRef: `mock-email-${this.outbox.length}-${Date.now()}`, errorCode: null };
  }

  /** Deterministic tokens, so the MOCK DNS can answer for them. */
  async createIdentity(domain: string): Promise<{ dkimTokens: string[] }> {
    return {
      dkimTokens: [1, 2, 3].map((n) => createHash('sha256').update(`${domain}:${n}`).digest('hex').slice(0, 32)),
    };
  }

  async deleteIdentity(): Promise<void> {
    return;
  }
}

/** RFC 2047 encoded-word for a non-ASCII display name (restaurant names carry Turkish letters). */
export function encodeDisplayName(name: string): string {
  const cleaned =
    name
      .replace(/[\r\n"<>]/g, ' ')
      .trim()
      .slice(0, 80) || 'Resget';
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(cleaned)) return `"${cleaned}"`;
  return `=?UTF-8?B?${Buffer.from(cleaned, 'utf8').toString('base64')}?=`;
}
