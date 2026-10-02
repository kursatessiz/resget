import { validateEnv } from './env';

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
    };
    expect(() => validateEnv(prod)).not.toThrow();
    expect(() => validateEnv({ ...prod, REDIS_URL: '' })).toThrow(/REDIS_URL/);
    expect(() => validateEnv({ ...prod, CORS_ORIGIN: '*' })).toThrow(/CORS_ORIGIN/);
    expect(() => validateEnv({ ...prod, PAYMENT_PROVIDER: 'MOCK' })).toThrow(/PAYMENT_PROVIDER/);
    expect(() => validateEnv({ ...prod, COURIER_PROVIDER: 'ACME' })).toThrow(/COURIER_API_KEY/);
  });

  it('requires provider credentials when a real payment provider is chosen', () => {
    expect(() => validateEnv({ ...base, PAYMENT_PROVIDER: 'IYZICO' })).toThrow(/IYZICO_API_KEY/);
    expect(() =>
      validateEnv({ ...base, PAYMENT_PROVIDER: 'IYZICO', IYZICO_API_KEY: 'a', IYZICO_SECRET_KEY: 'b' }),
    ).not.toThrow();
  });
});
