import { randomBytes } from 'node:crypto';
import { CredentialCipher, EnvKeyProvider, tokenFingerprint } from './credential-cipher';

describe('CredentialCipher', () => {
  const cipher = new CredentialCipher(new EnvKeyProvider(randomBytes(32).toString('base64')));

  it('round-trips JSON credentials with a fresh IV every time', () => {
    const creds = { merchantId: '123', merchantKey: 'abc' };
    const a = cipher.encryptJson(creds);
    const b = cipher.encryptJson(creds);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.env-1.')).toBe(true);
    expect(cipher.decryptJson(a)).toEqual(creds);
  });

  it('rejects tampered ciphertext and foreign keys', () => {
    const payload = cipher.encrypt('secret');
    // Flip one bit of the ciphertext body itself; editing a base64 character can land in padding bits and decode unchanged.
    const parts = payload.split('.');
    const body = Buffer.from(parts[4], 'base64');
    body[0] ^= 0x01;
    const tampered = [...parts.slice(0, 4), body.toString('base64')].join('.');
    expect(() => cipher.decrypt(tampered)).toThrow();
    const other = new CredentialCipher(new EnvKeyProvider(randomBytes(32).toString('base64')));
    expect(() => other.decrypt(payload)).toThrow();
    expect(() => new EnvKeyProvider('c2hvcnQ=')).toThrow(/32 bytes/);
  });

  it('fingerprints tokens deterministically', () => {
    expect(tokenFingerprint('tok_1')).toBe(tokenFingerprint('tok_1'));
    expect(tokenFingerprint('tok_1')).not.toBe(tokenFingerprint('tok_2'));
  });
});
