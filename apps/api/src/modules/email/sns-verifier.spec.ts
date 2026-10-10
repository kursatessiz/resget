import { createSign, generateKeyPairSync } from 'node:crypto';
import { SnsVerifier, isSnsMessage, isTrustedCertUrl, snsStringToSign } from './sns-verifier';
import type { SnsMessage } from './sns-verifier';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const CERT_URL = 'https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-abc.pem';

function signed(overrides: Partial<SnsMessage> = {}, version: '1' | '2' = '2'): SnsMessage {
  const message: SnsMessage = {
    Type: 'Notification',
    MessageId: 'm-1',
    TopicArn: 'arn:aws:sns:eu-central-1:123:ses-feedback',
    Message: JSON.stringify({ eventType: 'Bounce' }),
    Timestamp: '2026-10-04T12:00:00.000Z',
    SignatureVersion: version,
    Signature: '',
    SigningCertURL: CERT_URL,
    ...overrides,
  };
  const signer = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256');
  signer.update(snsStringToSign(message), 'utf8');
  return { ...message, Signature: signer.sign(privateKey, 'base64') };
}

describe('SNS verifier', () => {
  const fetched: string[] = [];
  const verifier = new SnsVerifier(async (url) => {
    fetched.push(url);
    return publicPem;
  });

  it('accepts a correctly signed message, version 1 and 2, and caches the certificate', async () => {
    expect(await verifier.verify(signed())).toBe(true);
    expect(await verifier.verify(signed({ Subject: 'Amazon SES Email Event Notification' }, '1'))).toBe(true);
    expect(fetched).toEqual([CERT_URL]);
  });

  it('rejects a tampered message, an unknown version and a foreign certificate host', async () => {
    expect(await verifier.verify({ ...signed(), Message: '{"eventType":"Complaint"}' })).toBe(false);
    expect(await verifier.verify({ ...signed(), SignatureVersion: '3' })).toBe(false);
    expect(await verifier.verify(signed({ SigningCertURL: 'https://evil.example/sns.pem' }))).toBe(false);
  });

  it('trusts only Amazon SNS hosts over HTTPS', () => {
    expect(isTrustedCertUrl(CERT_URL)).toBe(true);
    expect(isTrustedCertUrl('http://sns.eu-central-1.amazonaws.com/x.pem')).toBe(false);
    expect(isTrustedCertUrl('https://sns.eu-central-1.amazonaws.com.evil.example/x.pem')).toBe(false);
    expect(isTrustedCertUrl('https://sns.eu-central-1.amazonaws.com/x.txt')).toBe(false);
    expect(isTrustedCertUrl('https://sns.eu-central-1.amazonaws.com/x.pem?n=1')).toBe(false);
    expect(isTrustedCertUrl('https://sns.eu-central-1.amazonaws.com:8443/x.pem')).toBe(false);
  });

  it('recognises SNS messages and signs subscription confirmations with the token fields', () => {
    expect(isSnsMessage(signed())).toBe(true);
    expect(isSnsMessage({ Type: 'Notification' })).toBe(false);
    const confirmation = snsStringToSign({
      ...signed(),
      Type: 'SubscriptionConfirmation',
      SubscribeURL: 'https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription',
      Token: 't',
    });
    expect(confirmation).toContain('SubscribeURL\n');
    expect(confirmation).toContain('Token\nt\n');
  });
});

/** Reads the size of the verifier's private certificate cache. */
function cacheSize(verifier: SnsVerifier): number {
  return (verifier as unknown as { certificates: Map<string, string> }).certificates.size;
}

describe('SNS verifier certificate cache', () => {
  const origin = 'https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-abc.pem';

  function counting() {
    const fetched: string[] = [];
    const verifier = new SnsVerifier(async (url) => {
      fetched.push(url);
      return publicPem;
    });
    return { fetched, verifier };
  }

  it('keys the cache by the canonical URL, so query and fragment variants share one fetch', async () => {
    const { fetched, verifier } = counting();
    expect(await verifier.verify(signed({ SigningCertURL: origin }))).toBe(true);
    for (let i = 0; i < 20; i += 1) {
      expect(await verifier.verify(signed({ SigningCertURL: `${origin}#${i}` }))).toBe(true);
    }
    expect(fetched).toHaveLength(1);
  });

  it('does not cache a certificate until a signature has verified against it', async () => {
    const { fetched, verifier } = counting();
    const forged = { ...signed({ SigningCertURL: origin }), Signature: Buffer.from('forged').toString('base64') };
    for (let i = 0; i < 5; i += 1) {
      expect(await verifier.verify({ ...forged, SigningCertURL: `${origin}#${i}` })).toBe(false);
    }
    expect(await verifier.verify(forged)).toBe(false);
    // Nothing was cached by the failed attempts, so every one of them fetched; and nothing is retained.
    expect(fetched).toHaveLength(6);
    expect(cacheSize(verifier)).toBe(0);
  });

  it('bounds the cache and evicts the least recently used certificate', async () => {
    const { fetched, verifier } = counting();
    const urlFor = (n: number) => `https://sns.eu-central-1.amazonaws.com/cert-${n}.pem`;
    for (let n = 0; n < 100; n += 1) {
      expect(await verifier.verify(signed({ SigningCertURL: urlFor(n) }))).toBe(true);
    }
    expect(cacheSize(verifier)).toBeLessThanOrEqual(32);
    const before = fetched.length;
    expect(await verifier.verify(signed({ SigningCertURL: urlFor(99) }))).toBe(true);
    expect(fetched).toHaveLength(before);
    expect(await verifier.verify(signed({ SigningCertURL: urlFor(0) }))).toBe(true);
    expect(fetched).toHaveLength(before + 1);
  });
});
