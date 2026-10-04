import { createVerify } from 'node:crypto';

export interface SnsMessage {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

export function isSnsMessage(value: unknown): value is SnsMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    ['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'].includes(String(v.Type)) &&
    ['MessageId', 'TopicArn', 'Message', 'Timestamp', 'SignatureVersion', 'Signature', 'SigningCertURL'].every(
      (key) => typeof v[key] === 'string',
    )
  );
}

/** The fields SNS signs, in its order, for each message type. */
export function snsStringToSign(message: SnsMessage): string {
  const keys =
    message.Type === 'Notification'
      ? ['Message', 'MessageId', ...(message.Subject !== undefined ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return keys.map((key) => `${key}\n${String(message[key as keyof SnsMessage] ?? '')}\n`).join('');
}

/** Only Amazon's own SNS certificate hosts, over HTTPS. */
export function isTrustedCertUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(parsed.hostname) &&
      parsed.pathname.endsWith('.pem')
    );
  } catch {
    return false;
  }
}

export type CertificateFetcher = (url: string) => Promise<string>;

const defaultFetcher: CertificateFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`certificate fetch failed with ${res.status}`);
  return res.text();
};

/**
 * Verifies an SNS message signature (docs/EPOSTA.md): the certificate must
 * come from Amazon's SNS host, the signature must match the signed fields,
 * and the topic must be one we subscribed. Unverified messages are dropped.
 */
export class SnsVerifier {
  private readonly certificates = new Map<string, string>();

  constructor(private readonly fetchCertificate: CertificateFetcher = defaultFetcher) {}

  async verify(message: SnsMessage): Promise<boolean> {
    if (!isTrustedCertUrl(message.SigningCertURL)) return false;
    const algorithm =
      message.SignatureVersion === '1' ? 'RSA-SHA1' : message.SignatureVersion === '2' ? 'RSA-SHA256' : null;
    if (!algorithm) return false;
    let certificate = this.certificates.get(message.SigningCertURL);
    if (!certificate) {
      try {
        certificate = await this.fetchCertificate(message.SigningCertURL);
      } catch {
        return false;
      }
      this.certificates.set(message.SigningCertURL, certificate);
    }
    try {
      return createVerify(algorithm)
        .update(snsStringToSign(message), 'utf8')
        .verify(certificate, message.Signature, 'base64');
    } catch {
      return false;
    }
  }
}
