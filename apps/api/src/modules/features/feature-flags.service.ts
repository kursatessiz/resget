import { Injectable } from '@nestjs/common';
import { FEATURES, FEATURE_KEYS, enabledFeatures, isFeatureEnabled } from '@resget/shared';
import type { AdminFeatureDTO, FeatureKey, FeatureSwitches, RestaurantFeatureDTO } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { forbidden } from '../../common/api-error';

/** How long a process trusts its copy of the switches; writes in this process refresh it at once. */
const CACHE_TTL_MS = 15_000;

interface Snapshot {
  global: Partial<Record<FeatureKey, boolean>>;
  byRestaurant: Map<string, Partial<Record<FeatureKey, boolean>>>;
  loadedAt: number;
}

/**
 * Module switches (docs/OZELLIK_ANAHTARLARI.md): the global switch and the
 * per-restaurant switches from feature_flags, resolved against the shared
 * catalogue (restaurant, then global, then default). The table is small, so
 * every process keeps the whole of it and reloads it every few seconds;
 * another API process sees a change within that window.
 */
@Injectable()
export class FeatureFlagsService {
  private snapshot: Snapshot | null = null;
  private loading: Promise<Snapshot> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async switchesFor(restaurantId: string | null): Promise<FeatureSwitches> {
    const snapshot = await this.current();
    return {
      global: snapshot.global,
      restaurant: restaurantId ? (snapshot.byRestaurant.get(restaurantId) ?? {}) : {},
    };
  }

  async isEnabled(key: FeatureKey, restaurantId: string | null): Promise<boolean> {
    return isFeatureEnabled(key, await this.switchesFor(restaurantId));
  }

  /** Every module switched on for the restaurant, in catalogue order. */
  async enabledFor(restaurantId: string | null): Promise<FeatureKey[]> {
    return enabledFeatures(await this.switchesFor(restaurantId));
  }

  /** Refuses with FEATURE_DISABLED when the module is off for the restaurant. */
  async assertEnabled(key: FeatureKey, restaurantId: string | null): Promise<void> {
    if (!(await this.isEnabled(key, restaurantId))) {
      throw forbidden('FEATURE_DISABLED', `Feature ${key} is switched off`);
    }
  }

  // -- Console ------------------------------------------------------------------

  async adminList(): Promise<AdminFeatureDTO[]> {
    const rows = await this.prisma.featureFlag.findMany({
      include: { restaurant: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return FEATURE_KEYS.map((key) => {
      const global = rows.find((r) => r.key === key && r.scope === 'GLOBAL');
      return {
        key,
        group: FEATURES[key].group,
        stage: FEATURES[key].stage,
        defaultEnabled: FEATURES[key].defaultEnabled,
        global: global ? global.enabled : null,
        enabled: global ? global.enabled : FEATURES[key].defaultEnabled,
        overrides: rows
          .filter((r) => r.key === key && r.scope === 'RESTAURANT' && r.restaurant)
          .map((r) => ({
            restaurantId: r.restaurant!.id,
            restaurantName: r.restaurant!.name,
            slug: r.restaurant!.slug,
            enabled: r.enabled,
          })),
      };
    });
  }

  async restaurantList(restaurantId: string): Promise<RestaurantFeatureDTO[]> {
    const switches = await this.fresh().then(() => this.switchesFor(restaurantId));
    return FEATURE_KEYS.map((key) => ({
      key,
      group: FEATURES[key].group,
      stage: FEATURES[key].stage,
      enabled: isFeatureEnabled(key, switches),
      override: switches.restaurant[key] ?? null,
    }));
  }

  /** Sets (true / false) or clears (null) a switch, then refreshes this process's copy. */
  async set(key: FeatureKey, restaurantId: string | null, enabled: boolean | null): Promise<void> {
    const scope = restaurantId ? 'RESTAURANT' : 'GLOBAL';
    // A unique index over a nullable column treats NULLs as distinct, so the global row is found by query.
    const existing = await this.prisma.featureFlag.findFirst({ where: { key, scope, restaurantId } });
    if (enabled === null) {
      if (existing) await this.prisma.featureFlag.delete({ where: { id: existing.id } });
    } else if (existing) {
      await this.prisma.featureFlag.update({ where: { id: existing.id }, data: { enabled } });
    } else {
      await this.prisma.featureFlag.create({ data: { key, scope, restaurantId, enabled } });
    }
    await this.fresh();
  }

  // -- Cache --------------------------------------------------------------------

  private async current(): Promise<Snapshot> {
    if (this.snapshot && Date.now() - this.snapshot.loadedAt < CACHE_TTL_MS) return this.snapshot;
    return this.fresh();
  }

  private fresh(): Promise<Snapshot> {
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(): Promise<Snapshot> {
    const rows = await this.prisma.featureFlag.findMany({
      select: { key: true, scope: true, restaurantId: true, enabled: true },
    });
    const known = new Set<string>(FEATURE_KEYS);
    const snapshot: Snapshot = { global: {}, byRestaurant: new Map(), loadedAt: Date.now() };
    for (const row of rows) {
      // A key the catalogue no longer has is left alone and ignored.
      if (!known.has(row.key)) continue;
      const key = row.key as FeatureKey;
      if (row.scope === 'GLOBAL') snapshot.global[key] = row.enabled;
      else if (row.restaurantId) {
        const own = snapshot.byRestaurant.get(row.restaurantId) ?? {};
        own[key] = row.enabled;
        snapshot.byRestaurant.set(row.restaurantId, own);
      }
    }
    this.snapshot = snapshot;
    return snapshot;
  }
}
