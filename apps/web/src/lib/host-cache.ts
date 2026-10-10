/**
 * A small time-limited, size-bounded cache. The map keeps insertion order, so the first key is always the
 * least recently used one (a hit re-inserts its key at the end). Used by the middleware for the custom-domain
 * lookup, where the keys come from an anonymous client's Host header and must not be able to grow the heap.
 */
export class BoundedTtlCache<V> {
  private readonly entries = new Map<string, { value: V; until: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string, now: number = Date.now()): { value: V } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.until <= now) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { value: entry.value };
  }

  set(key: string, value: V, now: number = Date.now()): void {
    this.entries.delete(key);
    this.entries.set(key, { value, until: now + this.ttlMs });
    if (this.entries.size <= this.maxEntries) return;
    // Over the limit: drop everything expired first, then the least recently used until it fits.
    for (const [k, e] of this.entries) if (e.until <= now) this.entries.delete(k);
    for (const k of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(k);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
