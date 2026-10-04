import type { LocationPingInput } from '@resget/shared';

export type LocationPoint = LocationPingInput['points'][number];

/** Largest batch the API accepts per request (LocationPingSchema) and how many points wait while offline. */
export const LOCATION_BATCH_MAX = 60;
export const LOCATION_QUEUE_MAX = 600;
/** Points closer in time than this to the previous one are dropped; the API needs a position every few seconds, not every tick. */
export const LOCATION_MIN_INTERVAL_MS = 3000;
/** A fix worse than this is noise for a courier on a street and is not sent. */
export const LOCATION_MAX_ACCURACY_M = 100;

/**
 * Keeps the courier's positions between uploads (docs/SIPARIS_VE_SEVK.md,
 * section 7): thins bursts, drops poor fixes, caps memory while offline
 * and hands out API-sized batches that are only forgotten once accepted.
 */
export class LocationQueue {
  private points: LocationPoint[] = [];
  private lastAcceptedAt: number | null = null;

  get size(): number {
    return this.points.length;
  }

  /** Adds a fix; returns false when it was thinned or rejected. */
  push(point: LocationPoint): boolean {
    const recordedAt = Date.parse(point.recordedAt);
    if (!Number.isFinite(recordedAt)) return false;
    if (point.accuracyM !== undefined && point.accuracyM > LOCATION_MAX_ACCURACY_M) return false;
    if (this.lastAcceptedAt !== null && recordedAt - this.lastAcceptedAt < LOCATION_MIN_INTERVAL_MS) return false;
    this.lastAcceptedAt = recordedAt;
    this.points.push(point);
    if (this.points.length > LOCATION_QUEUE_MAX) this.points.splice(0, this.points.length - LOCATION_QUEUE_MAX);
    return true;
  }

  /** The oldest points up to the API limit; call `ack` once the upload succeeded. */
  nextBatch(): LocationPoint[] {
    return this.points.slice(0, LOCATION_BATCH_MAX);
  }

  ack(count: number): void {
    this.points.splice(0, count);
  }

  clear(): void {
    this.points = [];
    this.lastAcceptedAt = null;
  }
}
