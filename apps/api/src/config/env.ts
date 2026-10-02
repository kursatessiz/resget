import { z } from 'zod';

// Validated once at startup; the process refuses to boot on invalid config
// instead of falling back to insecure defaults.
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().optional(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    /** Comma-separated explicit origins; required in production. */
    CORS_ORIGIN: z.string().optional(),
    /** Base URL of the web app; table QR links and invite links are built on it. */
    PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
    PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
    APP_RELEASE: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/)
      .default('dev'),

    SMS_PROVIDER: z.enum(['MOCK', 'NETGSM', 'ILETI_MERKEZI', 'TWILIO']).default('MOCK'),
    NETGSM_USER: z.string().min(1).optional(),
    NETGSM_PASSWORD: z.string().min(1).optional(),
    NETGSM_HEADER: z.string().min(1).max(11).optional(),
    ILETI_MERKEZI_USER: z.string().min(1).optional(),
    ILETI_MERKEZI_PASSWORD: z.string().min(1).optional(),
    ILETI_MERKEZI_SENDER: z.string().min(1).max(11).optional(),
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    TWILIO_FROM_NUMBER: z.string().min(1).optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
    /** Fixed OTP for automated tests. Rejected outside NODE_ENV=test. */
    OTP_TEST_CODE: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),

    /**
     * Key for encrypting POS credentials and card vault tokens at rest (32 random bytes, base64:
     * `openssl rand -base64 32`). Required in production; development falls back to a fixed key.
     */
    CREDENTIAL_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be base64 for exactly 32 bytes')
      .optional(),
    /** Card vault the customers' cards are stored with (docs/ODEME.md). MOCK is refused in production. */
    CARD_VAULT_PROVIDER: z.enum(['MOCK', 'MASTERPASS']).default('MOCK'),
    MASTERPASS_CLIENT_ID: z.string().min(1).optional(),
    MASTERPASS_CLIENT_SECRET: z.string().min(1).optional(),
    /** The platform's own PSP merchant for PLATFORM_PSP restaurants. MOCK is refused in production. */
    PAYMENT_PROVIDER: z.enum(['MOCK', 'IYZICO', 'PAYTR', 'STRIPE']).default('MOCK'),
    IYZICO_API_KEY: z.string().min(1).optional(),
    IYZICO_SECRET_KEY: z.string().min(1).optional(),
    IYZICO_BASE_URL: z.string().url().optional(),
    PAYTR_MERCHANT_ID: z.string().min(1).optional(),
    PAYTR_MERCHANT_KEY: z.string().min(1).optional(),
    PAYTR_MERCHANT_SALT: z.string().min(1).optional(),
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

    /** Third-party courier network adapter (docs/KURYE.md). */
    COURIER_PROVIDER: z
      .string()
      .regex(/^[A-Z0-9_]{2,32}$/)
      .default('MOCK'),
    COURIER_API_KEY: z.string().min(1).optional(),
    COURIER_WEBHOOK_SECRET: z.string().min(16).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.OTP_TEST_CODE && env.NODE_ENV !== 'test') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTP_TEST_CODE'],
        message: 'only allowed when NODE_ENV=test',
      });
    }
    if (env.PAYMENT_PROVIDER === 'IYZICO' && (!env.IYZICO_API_KEY || !env.IYZICO_SECRET_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['IYZICO_API_KEY'],
        message: 'IYZICO_API_KEY and IYZICO_SECRET_KEY are required when PAYMENT_PROVIDER=IYZICO',
      });
    }
    if (
      env.PAYMENT_PROVIDER === 'PAYTR' &&
      (!env.PAYTR_MERCHANT_ID || !env.PAYTR_MERCHANT_KEY || !env.PAYTR_MERCHANT_SALT)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYTR_MERCHANT_ID'],
        message: 'PAYTR_* keys are required when PAYMENT_PROVIDER=PAYTR',
      });
    }
    if (env.PAYMENT_PROVIDER === 'STRIPE' && !env.STRIPE_SECRET_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRIPE_SECRET_KEY'],
        message: 'required when PAYMENT_PROVIDER=STRIPE',
      });
    }
    if (env.NODE_ENV !== 'production') return;
    if (!env.REDIS_URL)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['REDIS_URL'], message: 'required in production' });
    if (!env.CORS_ORIGIN || env.CORS_ORIGIN.split(',').includes('*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'must list explicit origins in production',
      });
    }
    if (env.PAYMENT_PROVIDER === 'MOCK') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_PROVIDER'],
        message: 'MOCK is not allowed in production',
      });
    }
    if (env.COURIER_PROVIDER !== 'MOCK' && !env.COURIER_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COURIER_API_KEY'],
        message: 'required for a real courier provider',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** An empty value means "not set" (compose passes every optional key, unset ones as ""). */
export function withoutEmptyValues(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''));
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(withoutEmptyValues(raw));
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}
