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
