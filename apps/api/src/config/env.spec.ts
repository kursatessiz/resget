import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvSchema, validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
};

describe('validateEnv', () => {
  it('accepts the development defaults and treats empty values as unset', () => {
    const env = validateEnv({ ...base, REDIS_URL: '', SMS_PROVIDER: '' });
    expect(env.NODE_ENV).toBe('development');
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.SMS_PROVIDER).toBe('MOCK');
    expect(env.COURIER_PROVIDER).toBe('MOCK');
  });

  it('refuses a short JWT secret and a test OTP outside tests', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ ...base, OTP_TEST_CODE: '123456' })).toThrow(/OTP_TEST_CODE/);
  });

  it('enforces production requirements: Redis, explicit CORS, no MOCK payments', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      REDIS_URL: 'redis://r:6379',
      CORS_ORIGIN: 'https://app.example.com',
      PAYMENT_PROVIDER: 'STRIPE',
      STRIPE_SECRET_KEY: 'sk',
      CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    };
    expect(() => validateEnv(prod)).not.toThrow();
    expect(() => validateEnv({ ...prod, REDIS_URL: '' })).toThrow(/REDIS_URL/);
    expect(() => validateEnv({ ...prod, CORS_ORIGIN: '*' })).toThrow(/CORS_ORIGIN/);
    expect(() => validateEnv({ ...prod, PAYMENT_PROVIDER: 'MOCK' })).toThrow(/PAYMENT_PROVIDER/);
    expect(() => validateEnv({ ...prod, COURIER_PROVIDER: 'ACME' })).toThrow(/COURIER_API_KEY/);
    expect(() => validateEnv({ ...prod, COURIER_PROVIDER: 'ACME', COURIER_API_KEY: 'k' })).toThrow(
      /COURIER_WEBHOOK_SECRET/,
    );
    // Secrets at rest are never encrypted with the fixed development key in production.
    expect(() => validateEnv({ ...prod, CREDENTIAL_ENCRYPTION_KEY: '' })).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
    // Deferred integrations do not block boot; they refuse at use instead (docs/CANLIYA_GECIS.md).
    expect(() =>
      validateEnv({ ...prod, CARD_VAULT_PROVIDER: 'MOCK', CONSENT_REGISTRY_PROVIDER: 'MOCK' }),
    ).not.toThrow();
  });

  it('requires provider credentials when a real payment provider is chosen', () => {
    expect(() => validateEnv({ ...base, PAYMENT_PROVIDER: 'IYZICO' })).toThrow(/IYZICO_API_KEY/);
    expect(() =>
      validateEnv({ ...base, PAYMENT_PROVIDER: 'IYZICO', IYZICO_API_KEY: 'a', IYZICO_SECRET_KEY: 'b' }),
    ).not.toThrow();
  });

  it('passes every key of the schema to the production API container', () => {
    // Compose hands the container only the keys it lists, so a key missing there can never be set in production.
    const compose = readFileSync(join(__dirname, '../../../../deploy/docker-compose.prod.yml'), 'utf8');
    const apiBlock = compose.slice(compose.indexOf('\n  api:'), compose.indexOf('\n  web:'));
    const listed = new Set([...apiBlock.matchAll(/^\s+([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]));
    // Test-only keys never reach production; the process refuses them outside NODE_ENV=test.
    const testOnly = new Set(['OTP_TEST_CODE']);
    const missing = Object.keys(EnvSchema.innerType().shape).filter((key) => !testOnly.has(key) && !listed.has(key));
    expect(missing).toEqual([]);
  });
});
