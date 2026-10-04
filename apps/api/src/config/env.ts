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
    /** Address geocoding (docs/VITRIN.md): NONE leaves points empty, MOCK is for development and tests, NOMINATIM asks OpenStreetMap. */
    GEOCODER_PROVIDER: z.enum(['NONE', 'MOCK', 'NOMINATIM', 'GOOGLE']).optional(),
    /** Server-side key of the Google Geocoding API; required when GEOCODER_PROVIDER=GOOGLE. */
    GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),
    /** A self-hosted Nominatim; the public instance is the default and allows one request per second. */
    NOMINATIM_BASE_URL: z.string().url().optional(),
    /** How a restaurant's custom domain is checked: real DNS, or MOCK (hosts under .verified.test pass); tests default to MOCK. */
    DOMAIN_VERIFIER: z.enum(['DNS', 'MOCK']).optional(),
    APP_RELEASE: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/)
      .default('dev'),

    SMS_PROVIDER: z.enum(['MOCK', 'NETGSM', 'ILETI_MERKEZI', 'TWILIO']).default('MOCK'),
    /** Push delivery: EXPO sends through Expo's push service; MOCK accepts outside production and refuses in it. */
    PUSH_PROVIDER: z.enum(['MOCK', 'EXPO']).default('MOCK'),
    EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
    NETGSM_USER: z.string().min(1).optional(),
    NETGSM_PASSWORD: z.string().min(1).optional(),
    NETGSM_HEADER: z.string().min(1).max(11).optional(),
    ILETI_MERKEZI_USER: z.string().min(1).optional(),
    ILETI_MERKEZI_PASSWORD: z.string().min(1).optional(),
    ILETI_MERKEZI_SENDER: z.string().min(1).max(11).optional(),
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    TWILIO_FROM_NUMBER: z.string().min(1).optional(),
    /** MOCK, or META for the WhatsApp Business Cloud API. */
    WHATSAPP_PROVIDER: z.enum(['MOCK', 'META']).default('MOCK'),
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
    CARD_VAULT_PROVIDER: z.enum(['MOCK', 'MASTERPASS', 'BEX']).default('MOCK'),
    MASTERPASS_CLIENT_ID: z.string().min(1).optional(),
    MASTERPASS_CLIENT_SECRET: z.string().min(1).optional(),
    BEX_MERCHANT_ID: z.string().min(1).optional(),
    BEX_MERCHANT_SECRET: z.string().min(1).optional(),
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

    /**
     * Road routing for own-courier trips (docs/SIPARIS_VE_SEVK.md). HAVERSINE is
     * straight-line distance times the restaurant's detour factor; a road
     * engine is added as an adapter and listed here.
     */
    ROUTING_PROVIDER: z.enum(['HAVERSINE', 'OSRM']).default('HAVERSINE'),
    /** OSRM route and table services; the public demo server by default, own or hosted OSRM in production. */
    OSRM_BASE_URL: z.string().url().optional(),

    /** Third-party courier network adapter (docs/KURYE.md). */
    COURIER_PROVIDER: z
      .string()
      .regex(/^[A-Z0-9_]{2,32}$/)
      .default('MOCK'),
    /** Unauthenticated order placements and funnel steps allowed per client per 10 minutes (docs/VITRIN.md). */
    /** The in-process daily billing job (docs/FATURALAMA.md); off when cron runs dist/cli/billing.js instead. */
    /** Where uploaded files (restaurant logos) live; a named volume in production, ./uploads in development. */
    UPLOADS_DIR: z.string().min(1).optional(),
    BILLING_SCHEDULER: z.enum(['on', 'off']).default('on'),
    /** The acceptance watchdog that alarms PLACED orders past their deadline (docs/SIPARIS_VE_SEVK.md). */
    ORDER_WATCHDOG: z.enum(['on', 'off']).default('on'),
    /** The in-process campaign queue (docs/KAMPANYALAR.md). */
    CAMPAIGN_RUNNER: z.enum(['on', 'off']).default('on'),
    /** The retry sweep for refunds of cancelled online orders (docs/ODEME.md 3b). */
    REFUND_RETRY: z.enum(['on', 'off']).default('on'),
    /** Outbound webhook deliveries (docs/API_ERISIMI.md); off when another process drains the queue. */
    WEBHOOK_RUNNER: z.enum(['on', 'off']).default('on'),
    /** Requests one API key may make per minute (docs/API_ERISIMI.md). */
    API_KEY_RATE_LIMIT: z.coerce.number().int().min(1).max(100000).default(600),
    /** Regional commercial-message consent registry (Turkey: IYS); MOCK approves every opted-in number. */
    CONSENT_REGISTRY_PROVIDER: z.enum(['MOCK']).default('MOCK'),
    /** Fiscal document integrator for commission invoices; MOCK until a contract exists. */
    INVOICE_PROVIDER: z.enum(['MOCK']).default('MOCK'),
    PUBLIC_ORDER_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(10),
    PUBLIC_FUNNEL_RATE_LIMIT: z.coerce.number().int().min(1).max(10000).default(60),
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
    const requires: Record<string, (keyof typeof env)[]> = {
      NETGSM: ['NETGSM_USER', 'NETGSM_PASSWORD', 'NETGSM_HEADER'],
      ILETI_MERKEZI: ['ILETI_MERKEZI_USER', 'ILETI_MERKEZI_PASSWORD', 'ILETI_MERKEZI_SENDER'],
      TWILIO: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],
    };
    for (const key of requires[env.SMS_PROVIDER] ?? []) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `required when SMS_PROVIDER=${env.SMS_PROVIDER}`,
        });
      }
    }
    if (env.WHATSAPP_PROVIDER === 'META') {
      for (const key of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'required when WHATSAPP_PROVIDER=META' });
        }
      }
    }
    if (env.GEOCODER_PROVIDER === 'GOOGLE' && !env.GOOGLE_MAPS_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_MAPS_API_KEY'],
        message: 'required when GEOCODER_PROVIDER=GOOGLE',
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
    if (env.GEOCODER_PROVIDER === 'MOCK') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GEOCODER_PROVIDER'],
        message: 'MOCK is not allowed in production',
      });
    }
    if (env.DOMAIN_VERIFIER === 'MOCK') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DOMAIN_VERIFIER'],
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
