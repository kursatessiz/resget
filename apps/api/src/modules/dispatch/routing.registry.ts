import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHaversineRouting } from '@resget/shared';
import type { DispatchSettings, RoutingProviderAdapter } from '@resget/shared';
import { createOsrmRouting } from './osrm.routing';

/**
 * Road routing providers by code, selected with ROUTING_PROVIDER and never
 * referenced from the trip flow. HAVERSINE is the straight line times the
 * restaurant's detour factor; OSRM asks a road engine (OSRM_BASE_URL) and
 * falls back to the straight line when it does not answer.
 */
@Injectable()
export class RoutingRegistry {
  readonly code: string;
  private readonly osrmBaseUrl: string;

  constructor(config: ConfigService) {
    this.code = config.get<string>('ROUTING_PROVIDER') ?? 'HAVERSINE';
    this.osrmBaseUrl = config.get<string>('OSRM_BASE_URL') ?? 'https://router.project-osrm.org';
  }

  adapterFor(settings: DispatchSettings): RoutingProviderAdapter {
    if (this.code === 'OSRM') return createOsrmRouting({ baseUrl: this.osrmBaseUrl, settings });
    return createHaversineRouting(settings);
  }
}
