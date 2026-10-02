import { z } from 'zod';

/** Server-only environment. Never imported from a client component. */
const ServerEnvSchema = z.object({
  /** Internal (docker-network) base URL of the API, e.g. http://api:4000. */
  API_INTERNAL_URL: z.string().url().default('http://localhost:4000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_RELEASE: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .default('dev'),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (typeof window !== 'undefined') throw new Error('getServerEnv() must not be called from client code');
  if (cached) return cached;
  const result = ServerEnvSchema.safeParse({
    API_INTERNAL_URL: process.env.API_INTERNAL_URL || undefined,
    NODE_ENV: process.env.NODE_ENV,
    APP_RELEASE: process.env.APP_RELEASE || undefined,
  });
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid web server environment configuration: ${details}`);
  }
  cached = result.data;
  return cached;
}

export function apiInternalBaseUrl(): string {
  return getServerEnv().API_INTERNAL_URL.replace(/\/+$/, '');
}
