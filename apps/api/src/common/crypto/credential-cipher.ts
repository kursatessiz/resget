import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encryption at rest for provider credentials and card vault tokens
 * (docs/ODEME.md). AES-256-GCM with a key the KeyProvider supplies; the
 * ciphertext carries the key version so keys can be rotated: new writes use
 * the current key, old rows decrypt with the version they were written with.
 *
 * In development the key comes from CREDENTIAL_ENCRYPTION_KEY. In production
 * the same interface is backed by a KMS (Google Cloud KMS or AWS KMS) through
 * envelope encryption: the data key is generated locally, wrapped by the KMS
 * and the wrapped form is what `keyVersion` identifies. Card numbers are
 * never encrypted here: the platform does not receive them.
 */
export interface KeyProvider {
  /** Version identifier of the key new ciphertexts are written with. */
  readonly currentVersion: string;
  key(version: string): Buffer;
}

export class EnvKeyProvider implements KeyProvider {
  readonly currentVersion = 'env-1';
  private readonly material: Buffer;

  constructor(base64Key: string) {
    const buf = Buffer.from(base64Key, 'base64');
    if (buf.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
    this.material = buf;
  }

  key(version: string): Buffer {
    if (version !== this.currentVersion) throw new Error(`Unknown key version ${version}`);
    return this.material;
  }
}

/** Format: v1.<keyVersion>.<iv b64>.<tag b64>.<ciphertext b64> */
const FORMAT = 'v1';

export class CredentialCipher {
  constructor(private readonly keys: KeyProvider) {}

  get keyVersion(): string {
    return this.keys.currentVersion;
  }

  encrypt(plaintext: string): string {
    const version = this.keys.currentVersion;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.key(version), iv);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [FORMAT, version, iv.toString('base64'), tag.toString('base64'), body.toString('base64')].join('.');
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 5 || parts[0] !== FORMAT) throw new Error('Malformed ciphertext');
    const [, version, iv, tag, body] = parts;
    const decipher = createDecipheriv('aes-256-gcm', this.keys.key(version), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  }

  encryptJson(value: Record<string, string>): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson(payload: string): Record<string, string> {
    return JSON.parse(this.decrypt(payload)) as Record<string, string>;
  }
}

/** Deterministic, non-reversible fingerprint of a token for uniqueness checks without decrypting rows. */
export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
