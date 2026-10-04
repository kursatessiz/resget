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
  /** Tile URL template of the map provider; OpenStreetMap's public tiles by default (docs/SIPARIS_VE_SEVK.md). */
  MAP_TILE_URL: z.string().url().default('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  /** Attribution the provider requires, shown on every map as plain text. */
  MAP_ATTRIBUTION: z.string().min(1).max(200).default('OpenStreetMap contributors'),
  MAP_MAX_ZOOM: z.coerce.number().int().min(1).max(22).default(19),
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
    MAP_TILE_URL: process.env.MAP_TILE_URL || undefined,
    MAP_ATTRIBUTION: process.env.MAP_ATTRIBUTION || undefined,
    MAP_MAX_ZOOM: process.env.MAP_MAX_ZOOM || undefined,
  });
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid web server environment configuration: ${details}`);
  }
  cached = result.data;
  return cached;
}

/** What a map needs from the deployment; passed to client components as props, never read there. */
export function mapTilesConfig(): { url: string; attribution: string; maxZoom: number } {
  const env = getServerEnv();
  return { url: env.MAP_TILE_URL, attribution: env.MAP_ATTRIBUTION, maxZoom: env.MAP_MAX_ZOOM };
}

export function apiInternalBaseUrl(): string {
  return getServerEnv().API_INTERNAL_URL.replace(/\/+$/, '');
}
