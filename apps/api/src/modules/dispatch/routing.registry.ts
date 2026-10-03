import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHaversineRouting } from '@resget/shared';
import type { DispatchSettings, RoutingProviderAdapter } from '@resget/shared';

/**
 * Road routing providers by code. HAVERSINE (straight line times the
 * restaurant's detour factor) ships today; a road engine is registered here
 * and selected with ROUTING_PROVIDER, never referenced from the trip flow.
 */
@Injectable()
export class RoutingRegistry {
  readonly code: string;

  constructor(config: ConfigService) {
    this.code = config.get<string>('ROUTING_PROVIDER') ?? 'HAVERSINE';
  }

  adapterFor(settings: DispatchSettings): RoutingProviderAdapter {
    return createHaversineRouting(settings);
  }
}
