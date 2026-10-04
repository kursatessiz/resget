import { Logger } from '@nestjs/common';
import { haversineLegs } from '@resget/shared';
import type { DispatchSettings, GeoPoint, RouteLeg, RoutingProviderAdapter } from '@resget/shared';

/** OSRM answers slower than this are treated as unavailable; the straight-line estimate is used instead. */
const OSRM_TIMEOUT_MS = 4000;

interface OsrmRouteResponse {
  code?: string;
  routes?: { legs?: { distance?: number; duration?: number }[] }[];
}

interface OsrmTableResponse {
  code?: string;
  distances?: (number | null)[][];
}

export interface OsrmRoutingOptions {
  baseUrl: string;
  settings: DispatchSettings;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  logger?: Pick<Logger, 'warn'>;
}

function coordinates(points: GeoPoint[]): string {
  return points.map((p) => `${p.lng},${p.lat}`).join(';');
}

/**
 * OSRM road engine (docs/SIPARIS_VE_SEVK.md, "Konum akışı"): legs from the
 * route service, the optimiser's distance matrix from the table service.
 * Any failure (network, timeout, an answer that is not "Ok") falls back to
 * the straight-line estimate so a routing outage never stalls dispatch; the
 * fallback is logged once per call. The public demo server is fine for
 * development; production runs its own OSRM or a hosted one (OSRM_BASE_URL).
 */
export function createOsrmRouting(options: OsrmRoutingOptions): RoutingProviderAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? OSRM_TIMEOUT_MS;
  const logger = options.logger ?? new Logger('OsrmRouting');

  const call = async <T>(path: string): Promise<T | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}${path}`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        logger.warn(`OSRM responded ${response.status}; using straight-line estimate`);
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      logger.warn(
        `OSRM unavailable (${error instanceof Error ? error.message : 'error'}); using straight-line estimate`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    code: 'OSRM',
    async legs(points: GeoPoint[]): Promise<RouteLeg[]> {
      if (points.length < 2) return [];
      const data = await call<OsrmRouteResponse>(
        `/route/v1/driving/${coordinates(points)}?overview=false&steps=false&annotations=false`,
      );
      const legs = data?.code === 'Ok' ? data.routes?.[0]?.legs : undefined;
      if (!legs || legs.length !== points.length - 1) return haversineLegs(points, options.settings);
      const mapped: RouteLeg[] = [];
      for (const leg of legs) {
        if (typeof leg.distance !== 'number' || typeof leg.duration !== 'number') {
          return haversineLegs(points, options.settings);
        }
        mapped.push({ distanceMeters: Math.round(leg.distance), durationSeconds: Math.round(leg.duration) });
      }
      return mapped;
    },
    async matrix(points: GeoPoint[]): Promise<number[][]> {
      const data = await call<OsrmTableResponse>(`/table/v1/driving/${coordinates(points)}?annotations=distance`);
      const rows = data?.code === 'Ok' ? data.distances : undefined;
      if (!rows || rows.length !== points.length) {
        return points.map((a) => points.map((b) => haversineLegs([a, b], options.settings)[0]?.distanceMeters ?? 0));
      }
      // An unreachable pair comes back null; the straight-line distance keeps the optimiser consistent.
      return rows.map((row, i) =>
        row.map((value, j) =>
          typeof value === 'number' && Number.isFinite(value)
            ? value
            : (haversineLegs([points[i], points[j]], options.settings)[0]?.distanceMeters ?? 0),
        ),
      );
    },
  };
}
